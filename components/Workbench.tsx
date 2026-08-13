/**
 * [INPUT]: optional projectId from route /p/[projectId]
 * [OUTPUT]: 聊天面板固定在右侧的工作台；有 projectId 时额外带历史会话栏
 * [POS]: B 域工作台装配层 —— 为每个 route project 创建独立 runtime store，再把 UI owner 下发给区域组件
 * [PROTOCOL]: 本文件不承载历史侧栏、编辑器、预览内部状态；新增区域状态先放到对应 workspace。
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkbenchController } from "@/hooks/useWorkbenchController";
import WorkbenchTopBar from "@/components/workbench/WorkbenchTopBar";
import ChatSidebar from "@/components/workbench/ChatSidebar";
import WorkspacePanels from "@/components/workbench/WorkspacePanels";
import ProjectWorkbenchBody from "@/components/workbench/ProjectWorkbenchBody";
import { ProjectRuntimeProvider } from "@/components/project/ProjectRuntimeProvider";
import Toast from "@/components/common/Toast";
import type { SendAttachment } from "@/lib/types";

type WorkbenchProps = {
  projectId?: string;
  initialPrompt?: string;
  initialAttachments?: SendAttachment[];
};

function WorkbenchContent({
  projectId,
  initialPrompt,
  initialAttachments = [],
}: WorkbenchProps) {
  const handleProjectInitialized = useCallback((project: { projectId: string; conversationId: string }) => {
    const nextPath = `/p/${project.projectId}`;
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, "", nextPath);
    }
  }, []);

  const s = useWorkbenchController({ onProjectInitialized: handleProjectInitialized });
  const {
    iframeRef, messages, files, activePath, code, hasActiveFileDraft, writing, activeFileSyncing,
    projName, status, overlay, setOverlay, previewRunPhase, previewUrl, runLogs, busy, hasResult,
    previewActive, currentProjectId, currentConversationId, lastTitleUpdate, openProject,
    openConversation: restoreConversation, loadFiles, runPreview, openFile, updateCode,
    saveActiveFile, newFile, renameActiveFile, deleteActiveFile, migrateToBrowserGit,
    storageKind, repositoryRevision, gitOperationRevision, gitStatus, gitCurrentBranch, gitLog, stageFile, unstageFile, commit,
    readProjectFiles, send, resume, stop,
  } = s;
  const [toast, setToast] = useState("");
  const [projectReady, setProjectReady] = useState(!projectId);
  const initialPromptSentRef = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1900);
  }, []);
  const markProjectReady = useCallback(() => setProjectReady(true), []);

  const chat = { messages, currentProjectId, onSend: send, onResume: resume, onStop: stop };
  const editor = {
    code,
    files,
    currentProjectId,
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
  const sourceControl = useMemo(() => ({
    storageKind,
    repositoryRevision,
    gitOperationRevision,
    status: gitStatus,
    currentBranch: gitCurrentBranch,
    log: () => gitLog({ depth: 20 }),
    stage: stageFile,
    unstage: unstageFile,
    commit,
  }), [commit, gitCurrentBranch, gitLog, gitOperationRevision, gitStatus, repositoryRevision, stageFile, storageKind, unstageFile]);

  useEffect(() => {
    if (initialPromptSentRef.current) return;
    if (!initialPrompt?.trim() && initialAttachments.length === 0) return;
    if (projectId && (!projectReady || currentProjectId !== projectId)) return;
    initialPromptSentRef.current = true;
    send(initialPrompt ?? "", initialAttachments);
  }, [currentProjectId, initialAttachments, initialPrompt, projectId, projectReady, send]);

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
            migrateToBrowserGit,
          }}
          onToast={showToast}
          chat={chat}
          editor={editor}
          preview={preview}
          sourceControl={sourceControl}
          readProjectFiles={readProjectFiles}
          onProjectReady={markProjectReady}
        />
      ) : (
        <main className="flex-1 flex min-h-0">
          <WorkspacePanels editor={editor} preview={preview} />
          <ChatSidebar messages={chat.messages} projectId={chat.currentProjectId} onSend={chat.onSend} onResume={chat.onResume} onStop={chat.onStop} />
        </main>
      )}

      <Toast message={toast} />
    </div>
  );
}

export default function Workbench(props: WorkbenchProps) {
  return (
    <ProjectRuntimeProvider
      key={props.projectId ?? "draft"}
      initialProjectId={props.projectId}
    >
      <WorkbenchContent {...props} />
    </ProjectRuntimeProvider>
  );
}
