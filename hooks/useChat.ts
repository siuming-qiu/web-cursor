/**
 * [INPUT]: 用户 prompt、项目/会话恢复请求、项目文件 REST API
 * [OUTPUT]: 会话 UI 状态、项目文件状态、手动编辑动作、src/App.tsx 预览状态
 * [POS]: B 域编排 hook —— 串起 /api/chat SSE、项目文件接口、Monaco 编辑器和 iframe 沙箱
 * [PROTOCOL]: 当前代码事实源是 project_files；收到 files_changed 后重新读取文件，不再依赖 code SSE。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { req } from "@/lib/api";
import { buildExportHtml } from "@/lib/export";
import { SandboxController } from "@/lib/sandbox/controller";
import { compileProject, TranspileError, type TranspileProjectFile } from "@/lib/transpile";
import { streamChat } from "@/lib/chatClient";
import type { AgentFileChange, Message, SendAttachment, Status, Overlay } from "@/lib/types";
import type { ChatEvent, ChatTurn } from "@/types/chat";
import { ChatEventType } from "@/types/chat";
import { ToolName } from "@/types/tool";
import { ToolResultType } from "@/types/tool";
import {
  FileContentAction,
  type ProjectFileContent,
  type ProjectFileSummary,
} from "@/lib/projectTypes";

const APP_ENTRY_PATH = "src/App.tsx";
const REQUIRED_PROJECT_FILES = ["package.json", "index.html", "src/main.tsx", APP_ENTRY_PATH] as const;
const EMPTY_OVERLAY: Overlay = { show: false, message: "", stack: "", showStack: false };

type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  meta?: unknown;
};

type FilesResponse = {
  files: ProjectFileSummary[];
};

type FilesWithContentResponse = {
  files: ProjectFileContent[];
};

type ProjectRef = {
  id: string;
  title: string;
  files?: ProjectFileSummary[];
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function chooseFile(files: ProjectFileSummary[], preferredPath?: string) {
  if (preferredPath && files.some((file) => file.path === preferredPath)) return preferredPath;
  if (files.some((file) => file.path === APP_ENTRY_PATH)) return APP_ENTRY_PATH;
  return files[0]?.path;
}

function hasCompleteReactProject(files: Pick<ProjectFileSummary, "path">[]) {
  const paths = new Set(files.map((file) => file.path));
  return REQUIRED_PROJECT_FILES.every((path) => paths.has(path));
}

export function useChat() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sandboxRef = useRef<SandboxController | null>(null);
  const abortRef = useRef({ aborted: false });
  const curAiIdRef = useRef<string>("");
  const lastPromptRef = useRef<string>("");
  const lastAttachmentsRef = useRef<SendAttachment[]>([]);
  const projectIdRef = useRef<string | undefined>(undefined);
  const convIdRef = useRef<string | undefined>(undefined);
  const activePathRef = useRef<string | undefined>(undefined);
  const dirtyRef = useRef(false);
  const fileContentsRef = useRef(new Map<string, string>());

  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<ProjectFileSummary[]>([]);
  const [activePath, setActivePath] = useState<string | undefined>(undefined);
  const [code, setCode] = useState("");
  const [dirty, setDirty] = useState(false);
  const [writing, setWriting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projName, setProjName] = useState("未命名项目");
  const [status, setStatus] = useState<Status>({ kind: "", text: "等待生成" });
  const [overlay, setOverlay] = useState<Overlay>(EMPTY_OVERLAY);
  const [busy, setBusy] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>(undefined);
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>(undefined);
  const [lastTitleUpdate, setLastTitleUpdate] = useState<{
    conversationId: string;
    title: string;
    projectTitle?: string;
  } | null>(null);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const ensureSandbox = useCallback(() => {
    if (iframeRef.current && !sandboxRef.current) {
      const ctl = new SandboxController(iframeRef.current);
      ctl.onLateError = (e) =>
        setOverlay({ show: true, message: e.message, stack: e.stack, showStack: false });
      sandboxRef.current = ctl;
    }
    return sandboxRef.current;
  }, []);

  const waitForSandbox = useCallback(async () => {
    for (let i = 0; i < 8; i++) {
      const sandbox = ensureSandbox();
      if (sandbox) return sandbox;
      await nextFrame();
    }
    return null;
  }, [ensureSandbox]);

  useEffect(() => {
    ensureSandbox();
  });

  useEffect(() => {
    return () => sandboxRef.current?.dispose();
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

  const loadProjectFileContents = useCallback(async (projectId: string) => {
    const response = await req<FilesWithContentResponse>(
      "GET",
      `/api/projects/${projectId}/files?includeContent=1`
    );
    fileContentsRef.current = new Map(response.files.map((file) => [file.path, file.content]));
    const summaries = response.files.map(({ content: _content, ...summary }) => summary);
    setFiles(summaries);
    return summaries;
  }, []);

  const openFile = useCallback(
    (path: string) => {
      if (!fileContentsRef.current.has(path)) {
        setStatus({ kind: "err", text: "文件内容未加载", meta: path });
        return;
      }
      activePathRef.current = path;
      setActivePath(path);
      setCode(fileContentsRef.current.get(path) ?? "");
      dirtyRef.current = false;
      setDirty(false);
    },
    []
  );

  const loadFiles = useCallback(
    async (projectId = projectIdRef.current, preferredPath?: string) => {
      if (!projectId) return [];
      const nextFiles = await loadProjectFileContents(projectId);

      const nextPath = chooseFile(nextFiles, preferredPath ?? activePathRef.current);
      if (nextPath) {
        openFile(nextPath);
      } else {
        activePathRef.current = undefined;
        setActivePath(undefined);
        setCode("");
        dirtyRef.current = false;
        setDirty(false);
      }
      return nextFiles;
    },
    [loadProjectFileContents, openFile]
  );

  const readProjectFiles = useCallback(
    async (projectId: string): Promise<TranspileProjectFile[]> => {
      if (fileContentsRef.current.size === 0) {
        await loadProjectFileContents(projectId);
      }
      return [...fileContentsRef.current.entries()].map(([path, content]) => ({ path, content }));
    },
    [loadProjectFileContents]
  );

  const syncFileChange = useCallback(
    async (ev: Extract<ChatEvent, { type: typeof ChatEventType.FilesChanged }>) => {
      const projectId = projectIdRef.current;
      if (!projectId || !ev.path || !ev.operation) return;

      const nextFiles = await loadProjectFileContents(projectId);

      if (ev.operation === "delete") {
        const nextPath = chooseFile(nextFiles, APP_ENTRY_PATH);
        if (nextPath) openFile(nextPath);
        else {
          activePathRef.current = undefined;
          setActivePath(undefined);
          setCode("");
          setDirty(false);
          dirtyRef.current = false;
        }
        return;
      }

      openFile(ev.path);
    },
    [loadProjectFileContents, openFile]
  );

  const runPreview = useCallback(
    async (projectId = projectIdRef.current) => {
      if (!projectId) return false;
      let projectFiles: TranspileProjectFile[];
      try {
        projectFiles = await readProjectFiles(projectId);
      } catch {
        setStatus({ kind: "err", text: "读取预览文件失败" });
        setPreviewActive(false);
        return false;
      }

      if (!hasCompleteReactProject(projectFiles)) {
        setPreviewActive(false);
        setHasResult(false);
        setOverlay(EMPTY_OVERLAY);
        setStatus({ kind: "", text: "生成完整 React 项目后可预览" });
        return false;
      }

      setPreviewActive(true);
      setStatus({ kind: "load", text: "编译项目中…（esbuild-wasm）" });
      try {
        const compiled = await compileProject(projectFiles);
        setStatus({ kind: "load", text: "执行中…" });
        const sandbox = await waitForSandbox();
        if (!sandbox) {
          setStatus({ kind: "", text: `${compiled.entryPath} 已编译，等待预览挂载` });
          return false;
        }
        const t0 = performance.now();
        const result = await sandbox.run(compiled);
        const dur = Math.round(performance.now() - t0);

        if (result?.type === ToolResultType.RenderOk) {
          setStatus({ kind: "ok", text: "渲染成功", meta: `· ${dur}ms` });
          setOverlay((o) => ({ ...o, show: false }));
          setHasResult(true);
          return true;
        }

        if (result) {
          setStatus({ kind: "err", text: "运行报错" });
          setOverlay({ show: true, message: result.message, stack: result.stack, showStack: false });
          return false;
        }

        setStatus({ kind: "", text: `${compiled.entryPath} 已加载` });
        return false;
      } catch (error) {
        const message = error instanceof TranspileError
          ? error.failures.map((failure) => failure.text).join("; ")
          : String(error instanceof Error ? error.message : error);
        setStatus({ kind: "err", text: "编译报错" });
        setOverlay({ show: true, message: "编译错误：" + message, stack: "", showStack: false });
        return false;
      }
    },
    [readProjectFiles, waitForSandbox]
  );

  const openProject = useCallback((project: ProjectRef) => {
    projectIdRef.current = project.id;
    convIdRef.current = undefined;
    activePathRef.current = undefined;
    setCurrentProjectId(project.id);
    setCurrentConversationId(undefined);
    setProjName(project.title || "未命名项目");
    setMessages([]);
    setFiles(project.files ?? []);
    setActivePath(undefined);
    setCode("");
    setDirty(false);
    setWriting(false);
    setSaving(false);
    setBusy(false);
    setHasResult(false);
    setPreviewActive(false);
    setOverlay(EMPTY_OVERLAY);
    setStatus({
      kind: "",
      text: hasCompleteReactProject(project.files ?? []) ? "选择会话或继续输入" : "生成完整 React 项目后可预览",
    });
  }, []);

  const openConversation = useCallback(
    async (project: ProjectRef, conversationId: string, rows: StoredMessage[]) => {
      projectIdRef.current = project.id;
      convIdRef.current = conversationId;
      activePathRef.current = undefined;
      setCurrentProjectId(project.id);
      setCurrentConversationId(conversationId);
      setProjName(project.title || "未命名项目");
      setWriting(false);
      setSaving(false);
      setBusy(false);
      setDirty(false);
      setOverlay(EMPTY_OVERLAY);

      const restored: Message[] = [];
      for (const row of rows) {
        if (row.role === "user") {
          restored.push({ id: row.id, role: "user", text: row.content });
        } else if (row.role === "assistant" && row.content.trim()) {
          restored.push({ id: row.id, role: "ai", attempts: [], chatText: row.content });
        }
      }

      setMessages(restored);
      try {
        const loadedFiles = await loadFiles(project.id, APP_ENTRY_PATH);
        if (hasCompleteReactProject(loadedFiles)) {
          await runPreview(project.id);
        } else {
          setPreviewActive(false);
          setHasResult(false);
          setStatus({ kind: "", text: "生成完整 React 项目后可预览" });
        }
      } catch (error) {
        setStatus({
          kind: "err",
          text: "恢复项目文件失败",
          meta: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [loadFiles, runPreview]
  );

  const refreshAfterFilesChanged = useCallback(async () => {
    const projectId = projectIdRef.current;
    if (!projectId) return false;
    await loadFiles(projectId, activePathRef.current ?? APP_ENTRY_PATH);
    return runPreview(projectId);
  }, [loadFiles, runPreview]);

  const runLoop = useCallback(
    async (firstMessage: string, attachments: SendAttachment[] = []) => {
      const turn: ChatTurn = {
        kind: "user",
        message: firstMessage,
        projectId: projectIdRef.current,
        conversationId: convIdRef.current,
        attachments: attachments.map((attachment) => ({ id: attachment.id })),
      };
      let filesChanged = false;

      setWriting(true);
      setStatus({ kind: "load", text: "AI 正在修改文件…" });

      try {
        for await (const ev of streamChat(turn)) {
          if (abortRef.current.aborted) return;

          if (ev.type === ChatEventType.Init) {
            projectIdRef.current = ev.projectId;
            convIdRef.current = ev.conversationId;
            setCurrentProjectId(ev.projectId);
            setCurrentConversationId(ev.conversationId);
          } else if (ev.type === ChatEventType.ToolsCall) {
            if (ev.name === ToolName.WriteFile || ev.name === ToolName.DeleteFile || ev.name === ToolName.RenameFile) {
              setStatus({ kind: "load", text: "AI 正在写入文件…" });
            } else if (ev.name === ToolName.ListFiles || ev.name === ToolName.ReadFile) {
              setStatus({ kind: "load", text: "AI 正在读取文件…" });
            }
          } else if (ev.type === ChatEventType.ToolResult) {
            if (ev.status === "error") {
              setStatus({ kind: "err", text: `${ev.name} 执行失败` });
            }
          } else if (ev.type === ChatEventType.FilesChanged) {
            filesChanged = true;
            if (ev.path && ev.operation) {
              appendFileChange({ operation: ev.operation, path: ev.path, oldPath: ev.oldPath });
              setStatus({ kind: "load", text: `AI 已更新 ${ev.path}` });
              await syncFileChange(ev);
            } else {
              setStatus({ kind: "load", text: "文件已更新，刷新预览…" });
            }
          } else if (ev.type === ChatEventType.Chat) {
            updateAi((m) => ({ ...m, chatText: (m.chatText ?? "") + ev.delta }));
          } else if (ev.type === ChatEventType.Title) {
            if (ev.projectTitle) setProjName(ev.projectTitle);
            setLastTitleUpdate({ conversationId: ev.conversationId, title: ev.title, projectTitle: ev.projectTitle });
          } else if (ev.type === ChatEventType.Error) {
            throw new Error(ev.message);
          }
        }
      } catch (error) {
        setWriting(false);
        setStatus({ kind: "err", text: "请求失败", meta: "" });
        setOverlay({ show: true, message: String(error instanceof Error ? error.message : error), stack: "", showStack: false });
        updateAi((m) => ({ ...m, summaryKind: "fail", summary: "调用后端失败" }));
        setBusy(false);
        return;
      }

      setWriting(false);

      if (filesChanged) {
        const ok = await refreshAfterFilesChanged();
        updateAi((m) => ({
          ...m,
          summaryKind: ok ? "ok" : "fail",
          summary: ok ? "已更新文件并渲染成功" : "已更新文件，但预览需要处理",
        }));
      } else {
        setStatus({ kind: "", text: "等待你的回复" });
      }
      setBusy(false);
    },
    [appendFileChange, refreshAfterFilesChanged, syncFileChange, updateAi]
  );

  const send = useCallback(
    (prompt: string, attachments: SendAttachment[] = []) => {
      const p = prompt.trim();
      if (busy || (!p && attachments.length === 0) || !ensureSandbox()) return;
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
      setOverlay(EMPTY_OVERLAY);
      abortRef.current = { aborted: false };

      runLoop(messageText, attachments).catch((err) => {
        setBusy(false);
        setWriting(false);
        setStatus({ kind: "err", text: "内部错误", meta: "" });
        setOverlay({ show: true, message: String(err?.message ?? err), stack: String(err?.stack ?? ""), showStack: false });
      });
    },
    [busy, ensureSandbox, runLoop]
  );

  const updateCode = useCallback((value: string) => {
    setCode(value);
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  const saveActiveFile = useCallback(async () => {
    const projectId = projectIdRef.current;
    const path = activePathRef.current;
    if (!projectId || !path) return;
    setSaving(true);
    try {
      await req<ProjectFileContent>("POST", `/api/projects/${projectId}/files/content`, {
        action: FileContentAction.Write,
        path,
        content: code,
      });
      fileContentsRef.current.set(path, code);
      dirtyRef.current = false;
      setDirty(false);
      await loadFiles(projectId, path);
      await runPreview(projectId);
    } finally {
      setSaving(false);
    }
  }, [code, loadFiles, runPreview]);

  const newFile = useCallback(async () => {
    const projectId = projectIdRef.current;
    if (!projectId) {
      window.alert("请先发送一次需求创建项目，再新建文件。");
      return;
    }
    const path = window.prompt("输入项目内文件路径，例如 src/components/Button.tsx");
    if (!path) return;
    setSaving(true);
    try {
      await req<ProjectFileContent>("POST", `/api/projects/${projectId}/files/content`, {
        action: FileContentAction.Write,
        path,
        content: "",
      });
      await loadFiles(projectId, path);
    } finally {
      setSaving(false);
    }
  }, [loadFiles]);

  const renameActiveFile = useCallback(async () => {
    const projectId = projectIdRef.current;
    const oldPath = activePathRef.current;
    if (!projectId || !oldPath) return;
    const newPath = window.prompt("输入新的项目内路径", oldPath);
    if (!newPath || newPath === oldPath) return;
    setSaving(true);
    try {
      await req<ProjectFileSummary>("POST", `/api/projects/${projectId}/files/rename`, { oldPath, newPath });
      await loadFiles(projectId, newPath);
      await runPreview(projectId);
    } finally {
      setSaving(false);
    }
  }, [loadFiles, runPreview]);

  const deleteActiveFile = useCallback(async () => {
    const projectId = projectIdRef.current;
    const path = activePathRef.current;
    if (!projectId || !path) return;
    if (!window.confirm(`删除 ${path}？`)) return;
    setSaving(true);
    try {
      await req<{ ok: true; path: string }>("POST", `/api/projects/${projectId}/files/content`, {
        action: FileContentAction.Delete,
        path,
      });
      await loadFiles(projectId, APP_ENTRY_PATH);
      await runPreview(projectId);
    } finally {
      setSaving(false);
    }
  }, [loadFiles, runPreview]);

  const exportProjectHtml = useCallback(async () => {
    const projectId = projectIdRef.current;
    if (!projectId) throw new Error("当前没有项目，无法导出。");
    return buildExportHtml(await readProjectFiles(projectId), projName);
  }, [projName, readProjectFiles]);

  const stop = useCallback(() => {
    abortRef.current.aborted = true;
    setBusy(false);
    setWriting(false);
    setStatus({ kind: "", text: "已停止" });
  }, []);

  const rerun = useCallback(() => {
    if (lastPromptRef.current) send(lastPromptRef.current, lastAttachmentsRef.current);
  }, [send]);

  return {
    iframeRef,
    curAiId: curAiIdRef,
    messages,
    files,
    activePath,
    code,
    dirty,
    writing,
    saving,
    projName,
    status,
    overlay,
    setOverlay,
    busy,
    hasResult,
    previewActive,
    currentProjectId,
    currentConversationId,
    lastTitleUpdate,
    openProject,
    openConversation,
    loadFiles,
    runPreview,
    openFile,
    updateCode,
    saveActiveFile,
    newFile,
    renameActiveFile,
    deleteActiveFile,
    exportProjectHtml,
    send,
    stop,
    rerun,
  };
}
