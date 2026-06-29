/**
 * [INPUT]: Workbench UI actions and project/conversation restore requests
 * [OUTPUT]: Workbench-facing state/actions composed from chat, files, and preview hooks
 * [POS]: B 域工作台组合层 —— 连接聊天 agent、文件编辑、预览执行
 * [PROTOCOL]: 子 hook 各守职责；这里只编排跨职责流程，如“保存后预览”。
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { useChat } from "@/hooks/useChat";
import { usePreview } from "@/hooks/usePreview";
import { type PersistedFileChange, useProjectFiles } from "@/hooks/useProjectFiles";
import type { ProjectFileSummary, StoredMessage } from "@/lib/projectTypes";
import { ChatEventType, type ChatEvent } from "@/types/chat";

type ProjectRef = {
  id: string;
  title: string;
  files?: ProjectFileSummary[];
};

const APP_ENTRY_PATH = "src/App.tsx";
const PREVIEW_ENTRY_FILES = ["index.html", "package.json"] as const;
const PREVIEW_SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".css"] as const;

function pathAffectsPreview(path: string) {
  return PREVIEW_ENTRY_FILES.includes(path as (typeof PREVIEW_ENTRY_FILES)[number])
    || PREVIEW_SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function persistedChangeAffectsPreview(change: PersistedFileChange) {
  return pathAffectsPreview(change.path) || (change.oldPath ? pathAffectsPreview(change.oldPath) : false);
}

export function useWorkbenchController() {
  const files = useProjectFiles();
  const preview = usePreview(files.readProjectFiles);
  const [projName, setProjName] = useState("未命名项目");

  const handlePersistedFileChange = useCallback(
    async (change: PersistedFileChange | null, source: "ai" | "user") => {
      if (!change) return null;
      const shouldRunPreview = persistedChangeAffectsPreview(change);
      if (!shouldRunPreview) {
        preview.setStatus({ kind: "", text: source === "user" ? "文件已保存，未触发预览" : "文件已更新，未触发预览" });
      }
      return { projectId: change.projectId, shouldRunPreview };
    },
    [preview.setStatus]
  );

  const handleUserPersistedFileChange = useCallback(
    async (change: PersistedFileChange | null) => {
      const handled = await handlePersistedFileChange(change, "user");
      if (handled?.shouldRunPreview) {
        await preview.runPreview(handled.projectId);
      } else if (change) {
        preview.setStatus({ kind: "", text: "文件已保存，未触发预览" });
      }

      change?.sync?.catch((error) => {
        preview.setOverlay({
          show: true,
          title: "Save Error",
          message: String(error instanceof Error ? error.message : error),
          stack: error instanceof Error ? error.stack ?? "" : "",
          showStack: false,
        });
        preview.setStatus({ kind: "err", text: "后端保存失败" });
      });
    },
    [handlePersistedFileChange, preview.runPreview, preview.setOverlay, preview.setStatus]
  );

  const chatDeps = useMemo(() => ({
    loadFiles: files.loadFiles,
    handlePersistedFileChange: async (ev: Extract<ChatEvent, { type: typeof ChatEventType.FilesChanged }>) => {
      const change = await files.syncFileChange(ev);
      return handlePersistedFileChange(change, "ai");
    },
    runPreview: preview.runPreview,
    setPreviewStatus: preview.setStatus,
    onError: (error: unknown) => {
      preview.setOverlay({
        show: true,
        title: "Agent Error",
        message: String(error instanceof Error ? error.message : error),
        stack: error instanceof Error ? error.stack ?? "" : "",
        showStack: false,
      });
    },
    onProjectInitialized: ({ projectId }: { projectId: string; conversationId: string }) => {
      files.setProjectFiles({ id: projectId, files: [] });
    },
    onTitleUpdate: (update: { conversationId: string; title: string; projectTitle?: string }) => {
      if (update.projectTitle) setProjName(update.projectTitle);
    },
  }), [
    files.loadFiles,
    files.setProjectFiles,
    files.syncFileChange,
    handlePersistedFileChange,
    preview.runPreview,
    preview.setOverlay,
    preview.setStatus,
  ]);

  const chat = useChat(chatDeps);

  const openProject = useCallback((project: ProjectRef) => {
    setProjName(project.title || "未命名项目");
    files.setProjectFiles(project);
    chat.openProjectChat({ id: project.id, title: project.title });
    preview.resetPreview(
      files.hasCompleteReactProject(project.files ?? []) ? "选择会话或继续输入" : "生成完整 React 项目后可预览"
    );
  }, [
    chat.openProjectChat,
    files.hasCompleteReactProject,
    files.setProjectFiles,
    preview.resetPreview,
  ]);

  const openConversation = useCallback(
    async (project: ProjectRef, conversationId: string, rows: StoredMessage[]) => {
      setProjName(project.title || "未命名项目");
      await chat.openConversation({ id: project.id, title: project.title }, conversationId, rows);
      const loadedFiles = await files.loadFiles(project.id, APP_ENTRY_PATH);
      if (files.hasCompleteReactProject(loadedFiles)) {
        await preview.runPreview(project.id);
      } else {
        preview.resetPreview("生成完整 React 项目后可预览");
      }
    },
    [
      chat.openConversation,
      files.hasCompleteReactProject,
      files.loadFiles,
      preview.resetPreview,
      preview.runPreview,
    ]
  );

  const saveActiveFile = useCallback(async () => {
    await handleUserPersistedFileChange(await files.saveActiveFile());
  }, [files.saveActiveFile, handleUserPersistedFileChange]);

  const newFile = useCallback(async (path: string) => {
    await handleUserPersistedFileChange(await files.newFile(path));
  }, [files.newFile, handleUserPersistedFileChange]);

  const renameActiveFile = useCallback(async (path: string) => {
    await handleUserPersistedFileChange(await files.renameActiveFile(path));
  }, [files.renameActiveFile, handleUserPersistedFileChange]);

  const deleteActiveFile = useCallback(async () => {
    await handleUserPersistedFileChange(await files.deleteActiveFile());
  }, [files.deleteActiveFile, handleUserPersistedFileChange]);

  const exportProjectHtml = useCallback(() => {
    return files.exportProjectHtml(projName);
  }, [files.exportProjectHtml, projName]);

  return {
    iframeRef: preview.iframeRef,
    curAiId: chat.curAiId,
    messages: chat.messages,
    files: files.files,
    activePath: files.activePath,
    code: files.activeFileDraftContent,
    hasActiveFileDraft: files.hasActiveFileDraft,
    writing: chat.writing,
    activeFileSyncing: files.activeFileSyncing,
    projName,
    status: preview.status,
    overlay: preview.overlay,
    setOverlay: preview.setOverlay,
    previewRunPhase: preview.previewRunPhase,
    busy: chat.busy,
    hasResult: preview.hasResult,
    previewActive: preview.previewActive,
    currentProjectId: chat.currentProjectId,
    currentConversationId: chat.currentConversationId,
    lastTitleUpdate: chat.lastTitleUpdate,
    openProject,
    openConversation,
    loadFiles: files.loadFiles,
    runPreview: preview.runPreview,
    openFile: files.openFile,
    updateCode: files.updateActiveFileDraft,
    saveActiveFile,
    newFile,
    renameActiveFile,
    deleteActiveFile,
    exportProjectHtml,
    send: chat.send,
    stop: chat.stop,
    rerun: chat.rerun,
  };
}
