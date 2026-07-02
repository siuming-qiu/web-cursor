/**
 * [INPUT]: optional projectId from route /p/[projectId]
 * [OUTPUT]: 三栏工作台；有 projectId 时带历史会话栏，无 projectId 时保持一期原始工作台
 * [POS]: B 域工作台装配层 —— 创建 runtime controller，把 UI owner 下发给区域组件
 * [PROTOCOL]: 本文件不承载历史侧栏、编辑器、预览内部状态；新增区域状态先放到对应 workspace。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkbenchController } from "@/hooks/useWorkbenchController";
import WorkbenchTopBar from "@/components/workbench/WorkbenchTopBar";
import ChatSidebar from "@/components/workbench/ChatSidebar";
import WorkspacePanels from "@/components/workbench/WorkspacePanels";
import ProjectWorkbenchBody from "@/components/workbench/ProjectWorkbenchBody";
import Toast from "@/components/common/Toast";
import type { SendAttachment } from "@/lib/types";

export default function Workbench({
  projectId,
  initialPrompt,
  initialAttachments = [],
}: {
  projectId?: string;
  initialPrompt?: string;
  initialAttachments?: SendAttachment[];
}) {
  const handleProjectInitialized = useCallback((project: { projectId: string; conversationId: string }) => {
    if (projectId) return;
    const nextPath = `/p/${project.projectId}`;
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, "", nextPath);
    }
  }, [projectId]);

  const s = useWorkbenchController({ onProjectInitialized: handleProjectInitialized });
  const {
    iframeRef, messages, files, activePath, code, hasActiveFileDraft, writing, activeFileSyncing,
    projName, status, overlay, setOverlay, previewRunPhase, previewUrl, runLogs, busy, hasResult,
    previewActive, currentProjectId, currentConversationId, lastTitleUpdate, openProject,
    openConversation: restoreConversation, loadFiles, runPreview, openFile, updateCode,
    saveActiveFile, newFile, renameActiveFile, deleteActiveFile, send, resume, stop,
  } = s;
  const [toast, setToast] = useState("");
  const initialPromptSentRef = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1900);
  }, []);

  const chat = { messages, currentProjectId, onSend: send, onResume: resume, onStop: stop };
  const editor = {
    code,
    files,
    activePath,
    hasActiveFileDraft,
    writing,
    activeFileSyncing,
    onChange: updateCode,
    onOpenFile: openFile,
    onSave: saveActiveFile,
    onNewFile: newFile,
    onRenameFile: renameActiveFile,
    onDeleteFile: deleteActiveFile,
  };
  const preview = {
    iframeRef,
    status,
    overlay,
    setOverlay,
    previewActive,
    previewRunPhase,
    previewUrl,
    runLogs,
    canAct: hasResult && !busy,
    currentProjectId,
    busy,
    runPreview,
  };

  useEffect(() => {
    if (initialPromptSentRef.current) return;
    if (!initialPrompt?.trim() && initialAttachments.length === 0) return;
    initialPromptSentRef.current = true;
    send(initialPrompt ?? "", initialAttachments);
  }, [initialAttachments, initialPrompt, send]);

  return (
    <div className="h-screen flex flex-col bg-bg">
      <WorkbenchTopBar
        projectRoute={!!projectId}
        projName={projName}
        previewRunPhase={previewRunPhase}
        status={status}
      />

      {projectId ? (
        <ProjectWorkbenchBody
          project={{
            projectId,
            currentConversationId,
            lastTitleUpdate,
            openProject,
            restoreConversation,
            loadFiles,
            runPreview,
          }}
          onToast={showToast}
          chat={chat}
          editor={editor}
          preview={preview}
        />
      ) : (
        <main className="flex-1 flex min-h-0">
          <ChatSidebar messages={chat.messages} projectId={chat.currentProjectId} onSend={chat.onSend} onResume={chat.onResume} onStop={chat.onStop} />
          <WorkspacePanels editor={editor} preview={preview} />
        </main>
      )}

      <Toast message={toast} />
    </div>
  );
}
