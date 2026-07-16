/**
 * [INPUT]: 用户 prompt、会话恢复请求、agent 运行依赖（文件刷新 / 预览运行）
 * [OUTPUT]: 聊天消息状态、send/stop/openConversation、agent loop 事件处理
 * [POS]: B 域聊天与 agent 编排 hook —— 只处理 chat/messages/SSE/tool loop
 * [PROTOCOL]: 不保存文件、不编译项目；文件与预览通过依赖回调注入。
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { postToolResult, streamChat } from "@/lib/chatClient";
import { useConversationStore } from "@/lib/conversationStore";
import { AiTimelineItemKind } from "@/lib/types";
import type { AgentFileChange, AiTimelineItem, ImageRunView, Message, SendAttachment, Status } from "@/lib/types";
import type { ProjectFileSummary } from "@/lib/projectTypes";
import type { ChatEvent, ChatTurn } from "@/types/chat";
import { ChatEventType } from "@/types/chat";
import { ImageJobStatus, ImageRunStatus } from "@/types/image";
import { isIntegrationCardMeta } from "@/types/integration";
import { ToolName, ToolResultType, type ToolResult } from "@/types/tool";
import { AttachmentSummarySchema } from "@/types/attachment";

const APP_ENTRY_PATH = "src/App.tsx";
const MAX_CLIENT_TOOL_RESUMES = 8;

type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  meta?: unknown;
  imageRuns?: ImageRunView[];
};

type ProjectRef = {
  id: string;
  title: string;
};

type TimelineStamp = Pick<AiTimelineItem, "receivedAt" | "order">;

const RestoredAttachmentSchema = AttachmentSummarySchema.array();

type UseChatDeps = {
  loadFiles: (projectId: string, preferredPath?: string) => Promise<ProjectFileSummary[]>;
  handlePersistedFileChange: (
    ev: Extract<ChatEvent, { type: typeof ChatEventType.FilesChanged }>
  ) => Promise<{ projectId: string; shouldRunPreview: boolean } | null>;
  runPreview: (projectId: string) => Promise<ToolResult | null>;
  setPreviewStatus: (status: Status) => void;
  onError: (error: unknown) => void;
  onProjectInitialized: (project: { projectId: string; conversationId: string }) => void;
  onTitleUpdate: (update: { conversationId: string; title: string; projectTitle?: string }) => void;
};

function previewSucceeded(result: ToolResult | null): boolean {
  return result?.status === "ok" && result.type === ToolResultType.ServerReady;
}

function previewSummary(
  result: ToolResult | null,
  shouldRunPreview: boolean,
  t: ReturnType<typeof useTranslations<"Agent">>
) {
  if (!shouldRunPreview) {
    return { summaryKind: "ok" as const, summary: t("filesUpdatedNoPreview") };
  }
  if (previewSucceeded(result)) {
    return { summaryKind: "ok" as const, summary: t("filesUpdatedRenderOk") };
  }
  if (result) {
    return { summaryKind: "fail" as const, summary: t("filesUpdatedPreviewFailed") };
  }
  return { summaryKind: "fail" as const, summary: t("filesUpdatedNoResult") };
}

function interruptedPreviewResult(message: string): ToolResult {
  return { status: "error", type: ToolResultType.ToolInterrupted, message };
}

function setAgentActivity(text: string) {
  useConversationStore.getState().setActivity(text);
}

function finishAgentTurn() {
  useConversationStore.getState().finishTurn();
}

function appendTimelineItem<T extends AiTimelineItem>(timeline: AiTimelineItem[] | undefined, item: T) {
  return [...(timeline ?? []), item];
}

function restoredAttachments(meta: unknown) {
  const rawAttachments = (meta as { attachments?: unknown } | null)?.attachments;
  if (rawAttachments === undefined) return undefined;

  const parsed = RestoredAttachmentSchema.safeParse(rawAttachments);
  if (!parsed.success) {
    console.warn("Invalid restored attachment meta", parsed.error.message);
    return undefined;
  }
  return parsed.data;
}

export function useChat(deps: UseChatDeps) {
  const t = useTranslations("Agent");
  const locale = useLocale();
  const activeRequestRef = useRef<AbortController | null>(null);
  const curAiIdRef = useRef<string>("");
  const lastPromptRef = useRef<string>("");
  const lastAttachmentsRef = useRef<SendAttachment[]>([]);
  const projectIdRef = useRef<string | undefined>(undefined);
  const convIdRef = useRef<string | undefined>(undefined);
  const timelineOrderRef = useRef(0);

  const [messages, setMessages] = useState<Message[]>([]);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>(undefined);
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>(undefined);
  const [lastTitleUpdate, setLastTitleUpdate] = useState<{
    conversationId: string;
    title: string;
    projectTitle?: string;
  } | null>(null);

  const setProjectContext = useCallback((projectId?: string, conversationId?: string) => {
    projectIdRef.current = projectId;
    convIdRef.current = conversationId;
    setCurrentProjectId(projectId);
    setCurrentConversationId(conversationId);
  }, []);

  const markTimeline = useCallback((): TimelineStamp => ({
    receivedAt: Date.now(),
    order: timelineOrderRef.current++,
  }), []);

  const updateAi = useCallback(
    (fn: (m: Extract<Message, { role: "ai" }>) => Extract<Message, { role: "ai" }>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === curAiIdRef.current && m.role === "ai" ? fn(m) : m))
      );
    },
    []
  );

  const appendFileChange = useCallback((change: Omit<AgentFileChange, "id">, stamp?: TimelineStamp) => {
    const changeId = crypto.randomUUID();
    updateAi((m) => ({
      ...m,
      fileChanges: [...(m.fileChanges ?? []), { ...change, id: changeId }],
      timeline: stamp
        ? appendTimelineItem(m.timeline, {
            id: `file-change-${changeId}`,
            kind: AiTimelineItemKind.FileChange,
            changeId,
            ...stamp,
          })
        : m.timeline,
    }));
  }, [updateAi]);

  const appendFileWriteStream = useCallback((ev: Extract<ChatEvent, { type: typeof ChatEventType.FileWriteStream }>, stamp: TimelineStamp) => {
    updateAi((m) => {
      const streams = m.fileWriteStreams ?? [];
      const existing = streams.find((stream) => stream.toolCallId === ev.toolCallId);
      if (!existing) {
        return {
          ...m,
          fileWriteStreams: [
            ...streams,
            {
              toolCallId: ev.toolCallId,
              path: ev.path,
              content: ev.delta ?? "",
              collapsed: false,
            },
          ],
          timeline: appendTimelineItem(m.timeline, {
            id: `file-write-stream-${ev.toolCallId}`,
            kind: AiTimelineItemKind.FileWriteStream,
            toolCallId: ev.toolCallId,
            ...stamp,
          }),
        };
      }

      return {
        ...m,
        fileWriteStreams: streams.map((stream) =>
          stream.toolCallId === ev.toolCallId
            ? {
                ...stream,
                path: ev.path ?? stream.path,
                content: stream.content + (ev.delta ?? ""),
                collapsed: false,
              }
            : stream
        ),
      };
    });
  }, [updateAi]);

  const collapseFileWriteStreams = useCallback(() => {
    updateAi((m) => ({
      ...m,
      fileWriteStreams: m.fileWriteStreams?.map((stream) => ({
        ...stream,
        collapsed: true,
      })),
    }));
  }, [updateAi]);

  const openProjectChat = useCallback((project: ProjectRef) => {
    timelineOrderRef.current = 0;
    setProjectContext(project.id, undefined);
    setMessages([]);
    setWriting(false);
    setBusy(false);
    finishAgentTurn();
  }, [setProjectContext]);

  const openConversation = useCallback(
    async (project: ProjectRef, conversationId: string, rows: StoredMessage[]) => {
      timelineOrderRef.current = 0;
      setProjectContext(project.id, conversationId);
      setWriting(false);
      setBusy(false);
      finishAgentTurn();

      const restored: Message[] = [];
      for (const row of rows) {
        if (row.role === "user") {
          restored.push({
            id: row.id,
            role: "user",
            text: row.content,
            attachments: restoredAttachments(row.meta),
          });
        } else if (row.role === "assistant" && row.content.trim()) {
          restored.push({
            id: row.id,
            role: "ai",
            attempts: [],
            chatText: row.content,
            imageRuns: row.imageRuns,
            integrationCard: isIntegrationCardMeta(row.meta) ? row.meta : undefined,
          });
        } else if (row.role === "assistant") {
          if (row.imageRuns?.length) {
            restored.push({
              id: row.id,
              role: "ai",
              attempts: [],
              imageRuns: row.imageRuns,
              integrationCard: isIntegrationCardMeta(row.meta) ? row.meta : undefined,
            });
          }
        }
      }
      setMessages(restored);
    },
    [setProjectContext]
  );

  const runLoop = useCallback(
    async (
      firstMessage: string,
      signal: AbortSignal,
      attachments: SendAttachment[] = [],
      initialTurn?: ChatTurn,
    ) => {
      let turn: ChatTurn = initialTurn ?? {
        kind: "user",
        message: firstMessage,
        projectId: projectIdRef.current,
        conversationId: convIdRef.current,
        attachments: attachments.map((attachment) => ({ id: attachment.id })),
      };

      setWriting(true);
      deps.setPreviewStatus({ kind: "load", text: t("modifyingFiles") });
      setAgentActivity(t("modifyingFiles"));

      async function consumeTurn(currentTurn: ChatTurn) {
        let filesChanged = false;
        let shouldRunPreviewForFilesChanged = false;
        let filesChangedProjectId: string | null = null;
        let previewToolCallId: string | null = null;

        for await (const ev of streamChat(currentTurn, locale, signal)) {
          if (signal.aborted) return { filesChanged, previewToolCallId, aborted: true };

          if (ev.type === ChatEventType.Init) {
            projectIdRef.current = ev.projectId;
            convIdRef.current = ev.conversationId;
            setCurrentProjectId(ev.projectId);
            setCurrentConversationId(ev.conversationId);
            deps.onProjectInitialized({ projectId: ev.projectId, conversationId: ev.conversationId });
          } else if (ev.type === ChatEventType.ToolsCall) {
            if (ev.name === ToolName.RunPreview) {
              previewToolCallId = ev.id;
              deps.setPreviewStatus({ kind: "load", text: t("runningPreview") });
              setAgentActivity(t("runningPreview"));
            } else if (ev.name === ToolName.WriteFile || ev.name === ToolName.DeleteFile || ev.name === ToolName.RenameFile) {
              deps.setPreviewStatus({ kind: "load", text: t("writingFiles") });
              setAgentActivity(t("writingFiles"));
            } else if (
              ev.name === ToolName.ListFiles
              || ev.name === ToolName.SearchText
              || ev.name === ToolName.ReadFile
            ) {
              deps.setPreviewStatus({ kind: "load", text: t("readingFiles") });
              setAgentActivity(t("readingFiles"));
            }
          } else if (ev.type === ChatEventType.ToolResult) {
            if (ev.status === "error") {
              deps.setPreviewStatus({ kind: "err", text: t("toolFailed", { name: ev.name }) });
              setAgentActivity(t("toolFailedHandling", { name: ev.name }));
            }
          } else if (ev.type === ChatEventType.ToolPending) {
            const stamp = markTimeline();
            updateAi((m) => ({
              ...m,
              imageRuns: [
                ...(m.imageRuns ?? []),
                {
                  runId: ev.runId,
                  toolCallId: ev.id,
                  status: ImageRunStatus.Pending,
                  resumeOnTerminal: true,
                  jobs: ev.jobs.map((job) => ({
                    id: job.jobId,
                    status: ImageJobStatus.Pending,
                    input: {
                      label: job.label,
                      prompt: job.prompt,
                      aspectRatio: job.aspectRatio,
                      inputImages: job.inputImages,
                    },
                  })),
                },
              ],
              timeline: appendTimelineItem(m.timeline, {
                id: `image-run-${ev.runId}`,
                kind: AiTimelineItemKind.ImageRun,
                runId: ev.runId,
                ...stamp,
              }),
            }));
            deps.setPreviewStatus({ kind: "load", text: t("generatingImages") });
            setAgentActivity(t("generatingImages"));
          } else if (ev.type === ChatEventType.FileWriteStream) {
            appendFileWriteStream(ev, markTimeline());
            deps.setPreviewStatus({ kind: "load", text: t("writingFiles") });
            setAgentActivity(t("writingFiles"));
          } else if (ev.type === ChatEventType.FilesChanged) {
            filesChanged = true;
            if (ev.path && ev.operation) {
              appendFileChange({ operation: ev.operation, path: ev.path, oldPath: ev.oldPath }, markTimeline());
              deps.setPreviewStatus({ kind: "load", text: t("fileUpdated", { path: ev.path }) });
              setAgentActivity(t("fileUpdatedHandling", { path: ev.path }));
              const handled = await deps.handlePersistedFileChange(ev);
              if (handled) {
                shouldRunPreviewForFilesChanged ||= handled.shouldRunPreview;
                filesChangedProjectId = handled.projectId;
              }
            } else {
              deps.setPreviewStatus({ kind: "load", text: t("filesUpdatedRefresh") });
              setAgentActivity(t("filesUpdatedPrepareRefresh"));
              const projectId = projectIdRef.current;
              if (projectId) {
                await deps.loadFiles(projectId, APP_ENTRY_PATH);
                shouldRunPreviewForFilesChanged = true;
                filesChangedProjectId = projectId;
              }
            }
          } else if (ev.type === ChatEventType.Chat) {
            const stamp = markTimeline();
            updateAi((m) => {
              const hasChatTimelineItem = m.timeline?.some((item) => item.kind === AiTimelineItemKind.Chat);
              return {
                ...m,
                chatText: (m.chatText ?? "") + ev.delta,
                timeline: hasChatTimelineItem
                  ? m.timeline
                  : appendTimelineItem(m.timeline, {
                      id: `chat-${m.id}`,
                      kind: AiTimelineItemKind.Chat,
                      ...stamp,
                    }),
              };
            });
            setAgentActivity(t("replying"));
          } else if (ev.type === ChatEventType.IntegrationCard) {
            updateAi((m) => ({ ...m, integrationCard: ev.meta }));
            setAgentActivity(t("waitingFigma"));
          } else if (ev.type === ChatEventType.Title) {
            const update = { conversationId: ev.conversationId, title: ev.title, projectTitle: ev.projectTitle };
            setLastTitleUpdate(update);
            deps.onTitleUpdate(update);
          } else if (ev.type === ChatEventType.Error) {
            throw new Error(ev.message);
          }
        }

        return {
          filesChanged,
          shouldRunPreviewForFilesChanged,
          filesChangedProjectId,
          previewToolCallId,
          aborted: false,
        };
      }

      try {
        for (let resumeCount = 0; resumeCount < MAX_CLIENT_TOOL_RESUMES; resumeCount++) {
          const result = await consumeTurn(turn);
          if (result.aborted || signal.aborted) return;

          if (!result.previewToolCallId) {
            collapseFileWriteStreams();
            if (result.filesChanged) {
              const preview = result.shouldRunPreviewForFilesChanged && result.filesChangedProjectId
                ? await deps.runPreview(result.filesChangedProjectId)
                : null;
              if (signal.aborted) return;
              const summary = previewSummary(preview, Boolean(result.shouldRunPreviewForFilesChanged), t);
              updateAi((m) => ({
                ...m,
                summaryKind: summary.summaryKind,
                summary: summary.summary,
              }));
              const conversationId = convIdRef.current;
              if (preview?.status === "error" && conversationId) {
                deps.setPreviewStatus({ kind: "load", text: t("previewErrorFixing") });
                setAgentActivity(t("previewErrorFixing"));
                turn = { kind: "preview_feedback", conversationId, result: preview };
                continue;
              }
            } else {
              deps.setPreviewStatus({ kind: "", text: t("waitingUser") });
            }
            setWriting(false);
            setBusy(false);
            finishAgentTurn();
            return;
          }

          const conversationId = convIdRef.current;
          const projectId = projectIdRef.current;
          if (!conversationId || !projectId) {
            throw new Error(t("missingConversation"));
          }

          if (result.filesChanged) {
            await deps.loadFiles(projectId, APP_ENTRY_PATH);
          }

          const preview = await deps.runPreview(projectId);
          if (signal.aborted) return;
          await postToolResult(
            conversationId,
            result.previewToolCallId,
            preview ?? interruptedPreviewResult(t("previewNoResult")),
            signal,
          );
          if (signal.aborted) return;

          const previewPassed = previewSucceeded(preview);
          deps.setPreviewStatus({
            kind: "load",
            text: previewPassed ? t("previewOkSummarizing") : t("previewErrorFixing"),
          });
          setAgentActivity(previewPassed ? t("previewOkSummarizing") : t("previewErrorFixing"));
          turn = { kind: "resume", conversationId };
        }

        throw new Error(t("resumeLimit", { max: MAX_CLIENT_TOOL_RESUMES }));
      } catch (error) {
        if (signal.aborted) return;
        setWriting(false);
        deps.setPreviewStatus({ kind: "err", text: t("requestFailed"), meta: "" });
        deps.onError(error);
        updateAi((m) => ({ ...m, summaryKind: "fail", summary: t("backendFailed") }));
        setBusy(false);
        finishAgentTurn();
        return;
      }
    },
    [appendFileChange, appendFileWriteStream, collapseFileWriteStreams, deps, locale, markTimeline, t, updateAi]
  );

  const send = useCallback(
    (prompt: string, attachments: SendAttachment[] = []) => {
      const p = prompt.trim();
      if (busy || (!p && attachments.length === 0)) return;
      const messageText = p || t("attachmentOnly");
      lastPromptRef.current = messageText;
      lastAttachmentsRef.current = attachments;
      timelineOrderRef.current = 0;

      const userId = crypto.randomUUID();
      const aiId = crypto.randomUUID();
      curAiIdRef.current = aiId;
      setMessages((prev) => [
        ...prev,
        {
          id: userId,
          role: "user",
          text: messageText,
          attachments: attachments.map((attachment) => ({
            id: attachment.id,
            type: attachment.type,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            name: attachment.name,
            previewUrl: attachment.previewUrl,
          })),
        },
        { id: aiId, role: "ai", attempts: [], fileChanges: [], timeline: [] },
      ]);
      setBusy(true);
      useConversationStore.getState().startTurn(aiId);
      const controller = new AbortController();
      activeRequestRef.current = controller;

      runLoop(messageText, controller.signal, attachments).catch((err) => {
        if (controller.signal.aborted) return;
        setBusy(false);
        setWriting(false);
        finishAgentTurn();
        deps.setPreviewStatus({ kind: "err", text: t("internalError"), meta: "" });
        deps.onError(err);
        updateAi((m) => ({ ...m, summaryKind: "fail", summary: t("backendFailed") }));
      }).finally(() => {
        if (activeRequestRef.current === controller) activeRequestRef.current = null;
      });
    },
    [busy, deps, runLoop, t, updateAi]
  );

  const resume = useCallback(() => {
    const conversationId = convIdRef.current;
    if (busy || !conversationId) return;

    const aiId = crypto.randomUUID();
    curAiIdRef.current = aiId;
    timelineOrderRef.current = 0;
    setMessages((prev) => [...prev, { id: aiId, role: "ai", attempts: [], fileChanges: [], timeline: [] }]);
    setBusy(true);
    setWriting(true);
    useConversationStore.getState().startTurn(aiId);
    const controller = new AbortController();
    activeRequestRef.current = controller;

    runLoop("", controller.signal, [], { kind: "resume", conversationId }).catch((err) => {
      if (controller.signal.aborted) return;
      setBusy(false);
      setWriting(false);
      finishAgentTurn();
      deps.setPreviewStatus({ kind: "err", text: t("internalError"), meta: "" });
      deps.onError(err);
      updateAi((m) => ({ ...m, summaryKind: "fail", summary: t("backendFailed") }));
    }).finally(() => {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    });
  }, [busy, deps, runLoop, t, updateAi]);

  const stop = useCallback(() => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setBusy(false);
    setWriting(false);
    useConversationStore.getState().stopTurn();
    deps.setPreviewStatus({ kind: "", text: t("stopped") });
  }, [deps, t]);

  const rerun = useCallback(() => {
    if (lastPromptRef.current) send(lastPromptRef.current, lastAttachmentsRef.current);
  }, [send]);

  return {
    curAiId: curAiIdRef,
    messages,
    writing,
    busy,
    currentProjectId,
    currentConversationId,
    lastTitleUpdate,
    setProjectContext,
    openProjectChat,
    openConversation,
    send,
    resume,
    stop,
    rerun,
  };
}
