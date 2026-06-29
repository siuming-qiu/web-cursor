/**
 * [INPUT]: 用户 prompt、会话恢复请求、agent 运行依赖（文件刷新 / 预览运行）
 * [OUTPUT]: 聊天消息状态、send/stop/openConversation、agent loop 事件处理
 * [POS]: B 域聊天与 agent 编排 hook —— 只处理 chat/messages/SSE/tool loop
 * [PROTOCOL]: 不保存文件、不编译项目；文件与预览通过依赖回调注入。
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { postToolResult, streamChat } from "@/lib/chatClient";
import { useConversationStore } from "@/lib/conversationStore";
import type { AgentFileChange, Message, SendAttachment, Status } from "@/lib/types";
import type { ProjectFileSummary } from "@/lib/projectTypes";
import type { ChatEvent, ChatTurn } from "@/types/chat";
import { ChatEventType } from "@/types/chat";
import { ToolName, ToolResultType, type ToolResult } from "@/types/tool";

const APP_ENTRY_PATH = "src/App.tsx";
const MAX_CLIENT_TOOL_RESUMES = 8;

type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  meta?: unknown;
};

type ProjectRef = {
  id: string;
  title: string;
};

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
  return result?.status === "ok" && result.type === ToolResultType.RenderOk;
}

function previewSummary(result: ToolResult | null, shouldRunPreview: boolean) {
  if (!shouldRunPreview) {
    return { summaryKind: "ok" as const, summary: "已更新文件，未触发预览" };
  }
  if (previewSucceeded(result)) {
    return { summaryKind: "ok" as const, summary: "已更新文件并渲染成功" };
  }
  if (result) {
    return { summaryKind: "fail" as const, summary: "已更新文件，预览失败，未自动回灌给 AI" };
  }
  return { summaryKind: "fail" as const, summary: "已更新文件，预览没有返回结果" };
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

export function useChat(deps: UseChatDeps) {
  const abortRef = useRef({ aborted: false });
  const curAiIdRef = useRef<string>("");
  const lastPromptRef = useRef<string>("");
  const lastAttachmentsRef = useRef<SendAttachment[]>([]);
  const projectIdRef = useRef<string | undefined>(undefined);
  const convIdRef = useRef<string | undefined>(undefined);

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

  const updateAi = useCallback(
    (fn: (m: Extract<Message, { role: "ai" }>) => Extract<Message, { role: "ai" }>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === curAiIdRef.current && m.role === "ai" ? fn(m) : m))
      );
    },
    []
  );

  const appendFileChange = useCallback((change: Omit<AgentFileChange, "id">) => {
    updateAi((m) => ({
      ...m,
      fileChanges: [...(m.fileChanges ?? []), { ...change, id: crypto.randomUUID() }],
    }));
  }, [updateAi]);

  const openProjectChat = useCallback((project: ProjectRef) => {
    setProjectContext(project.id, undefined);
    setMessages([]);
    setWriting(false);
    setBusy(false);
    finishAgentTurn();
  }, [setProjectContext]);

  const openConversation = useCallback(
    async (project: ProjectRef, conversationId: string, rows: StoredMessage[]) => {
      setProjectContext(project.id, conversationId);
      setWriting(false);
      setBusy(false);
      finishAgentTurn();

      const restored: Message[] = [];
      for (const row of rows) {
        if (row.role === "user") {
          restored.push({ id: row.id, role: "user", text: row.content });
        } else if (row.role === "assistant" && row.content.trim()) {
          restored.push({ id: row.id, role: "ai", attempts: [], chatText: row.content });
        }
      }
      setMessages(restored);
    },
    [setProjectContext]
  );

  const runLoop = useCallback(
    async (firstMessage: string, attachments: SendAttachment[] = []) => {
      let turn: ChatTurn = {
        kind: "user",
        message: firstMessage,
        projectId: projectIdRef.current,
        conversationId: convIdRef.current,
        attachments: attachments.map((attachment) => ({ id: attachment.id })),
      };

      setWriting(true);
      deps.setPreviewStatus({ kind: "load", text: "AI 正在修改文件…" });
      setAgentActivity("AI 正在修改文件…");

      async function consumeTurn(currentTurn: ChatTurn) {
        let filesChanged = false;
        let shouldRunPreviewForFilesChanged = false;
        let filesChangedProjectId: string | null = null;
        let previewToolCallId: string | null = null;

        for await (const ev of streamChat(currentTurn)) {
          if (abortRef.current.aborted) return { filesChanged, previewToolCallId, aborted: true };

          if (ev.type === ChatEventType.Init) {
            projectIdRef.current = ev.projectId;
            convIdRef.current = ev.conversationId;
            setCurrentProjectId(ev.projectId);
            setCurrentConversationId(ev.conversationId);
            deps.onProjectInitialized({ projectId: ev.projectId, conversationId: ev.conversationId });
          } else if (ev.type === ChatEventType.ToolsCall) {
            if (ev.name === ToolName.RunPreview) {
              previewToolCallId = ev.id;
              deps.setPreviewStatus({ kind: "load", text: "正在运行预览…" });
              setAgentActivity("正在运行预览…");
            } else if (ev.name === ToolName.WriteFile || ev.name === ToolName.DeleteFile || ev.name === ToolName.RenameFile) {
              deps.setPreviewStatus({ kind: "load", text: "AI 正在写入文件…" });
              setAgentActivity("AI 正在写入文件…");
            } else if (ev.name === ToolName.ListFiles || ev.name === ToolName.ReadFile) {
              deps.setPreviewStatus({ kind: "load", text: "AI 正在读取文件…" });
              setAgentActivity("AI 正在读取文件…");
            }
          } else if (ev.type === ChatEventType.ToolResult) {
            if (ev.status === "error") {
              deps.setPreviewStatus({ kind: "err", text: `${ev.name} 执行失败` });
              setAgentActivity(`${ev.name} 执行失败，AI 正在处理…`);
            }
          } else if (ev.type === ChatEventType.FilesChanged) {
            filesChanged = true;
            if (ev.path && ev.operation) {
              appendFileChange({ operation: ev.operation, path: ev.path, oldPath: ev.oldPath });
              deps.setPreviewStatus({ kind: "load", text: `AI 已更新 ${ev.path}` });
              setAgentActivity(`AI 已更新 ${ev.path}，继续处理中…`);
              const handled = await deps.handlePersistedFileChange(ev);
              if (handled) {
                shouldRunPreviewForFilesChanged ||= handled.shouldRunPreview;
                filesChangedProjectId = handled.projectId;
              }
            } else {
              deps.setPreviewStatus({ kind: "load", text: "文件已更新，刷新预览…" });
              setAgentActivity("文件已更新，准备刷新预览…");
              const projectId = projectIdRef.current;
              if (projectId) {
                await deps.loadFiles(projectId, APP_ENTRY_PATH);
                shouldRunPreviewForFilesChanged = true;
                filesChangedProjectId = projectId;
              }
            }
          } else if (ev.type === ChatEventType.Chat) {
            updateAi((m) => ({ ...m, chatText: (m.chatText ?? "") + ev.delta }));
            setAgentActivity("AI 正在回复…");
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
          if (result.aborted) return;

          if (!result.previewToolCallId) {
            if (result.filesChanged) {
              const preview = result.shouldRunPreviewForFilesChanged && result.filesChangedProjectId
                ? await deps.runPreview(result.filesChangedProjectId)
                : null;
              const summary = previewSummary(preview, Boolean(result.shouldRunPreviewForFilesChanged));
              updateAi((m) => ({
                ...m,
                summaryKind: summary.summaryKind,
                summary: summary.summary,
              }));
            } else {
              deps.setPreviewStatus({ kind: "", text: "等待你的回复" });
            }
            setWriting(false);
            setBusy(false);
            finishAgentTurn();
            return;
          }

          const conversationId = convIdRef.current;
          const projectId = projectIdRef.current;
          if (!conversationId || !projectId) {
            throw new Error("缺少会话或项目信息，无法写入预览结果。");
          }

          if (result.filesChanged) {
            await deps.loadFiles(projectId, APP_ENTRY_PATH);
          }

          const preview = await deps.runPreview(projectId);
          await postToolResult(
            conversationId,
            result.previewToolCallId,
            preview ?? interruptedPreviewResult("预览没有返回结果。")
          );

          deps.setPreviewStatus({
            kind: "load",
            text: previewSucceeded(preview) ? "预览通过，AI 正在总结…" : "AI 正在根据预览错误修复…",
          });
          setAgentActivity(previewSucceeded(preview) ? "预览通过，AI 正在总结…" : "AI 正在根据预览错误修复…");
          turn = { kind: "resume", conversationId };
        }

        throw new Error(`浏览器工具续写超过上限 ${MAX_CLIENT_TOOL_RESUMES} 轮，已停止。`);
      } catch (error) {
        setWriting(false);
        deps.setPreviewStatus({ kind: "err", text: "请求失败", meta: "" });
        deps.onError(error);
        updateAi((m) => ({ ...m, summaryKind: "fail", summary: "调用后端失败" }));
        setBusy(false);
        finishAgentTurn();
        return;
      }
    },
    [appendFileChange, deps, updateAi]
  );

  const send = useCallback(
    (prompt: string, attachments: SendAttachment[] = []) => {
      const p = prompt.trim();
      if (busy || (!p && attachments.length === 0)) return;
      const messageText = p || "请查看附件。";
      lastPromptRef.current = messageText;
      lastAttachmentsRef.current = attachments;

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
        { id: aiId, role: "ai", attempts: [], fileChanges: [] },
      ]);
      setBusy(true);
      useConversationStore.getState().startTurn(aiId);
      abortRef.current = { aborted: false };

      runLoop(messageText, attachments).catch((err) => {
        setBusy(false);
        setWriting(false);
        finishAgentTurn();
        deps.setPreviewStatus({ kind: "err", text: "内部错误", meta: "" });
        deps.onError(err);
        updateAi((m) => ({ ...m, summaryKind: "fail", summary: "调用后端失败" }));
      });
    },
    [busy, deps, runLoop, updateAi]
  );

  const stop = useCallback(() => {
    abortRef.current.aborted = true;
    setBusy(false);
    setWriting(false);
    useConversationStore.getState().stopTurn();
    deps.setPreviewStatus({ kind: "", text: "已停止" });
  }, [deps]);

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
    stop,
    rerun,
  };
}
