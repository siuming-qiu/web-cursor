"use client";

import { useCallback, type RefObject } from "react";
import { useProjectSession } from "@/hooks/useProjectSession";
import type { ProjectDetail, ProjectFileSummary, StoredMessage } from "@/lib/projectTypes";
import type { Message, Overlay, SendAttachment, Status } from "@/lib/types";
import type { PreviewRunPhase } from "@/hooks/usePreview";
import ConversationSidebar from "@/components/workbench/ConversationSidebar";
import WorkspacePanels, { type EditorWorkspaceModel, type PreviewWorkspaceModel } from "@/components/workbench/WorkspacePanels";
import WorkbenchSkeleton from "@/components/workbench/WorkbenchSkeleton";

type ProjectRef = {
  id: string;
  title: string;
  files?: ProjectFileSummary[];
};

type TitleUpdate = {
  conversationId: string;
  title: string;
  projectTitle?: string;
};

export type ProjectSessionModel = {
  projectId: string;
  currentConversationId?: string;
  lastTitleUpdate: TitleUpdate | null;
  openProject: (project: ProjectRef) => void;
  restoreConversation: (project: ProjectRef, conversationId: string, rows: StoredMessage[]) => Promise<void>;
  loadFiles: (projectId: string, preferredPath?: string) => Promise<ProjectDetail["files"]>;
  runPreview: (projectId: string) => Promise<unknown>;
};

type ChatWorkspaceModel = {
  messages: Message[];
  currentProjectId?: string;
  onSend: (text: string, attachments?: SendAttachment[]) => void;
  onResume: () => void;
  onStop: () => void;
};

type ProjectWorkbenchBodyProps = {
  project: ProjectSessionModel;
  onToast: (message: string) => void;
  chat: ChatWorkspaceModel;
  editor: EditorWorkspaceModel;
  preview: PreviewWorkspaceModel;
};

export default function ProjectWorkbenchBody({
  project,
  onToast,
  chat,
  editor,
  preview,
}: ProjectWorkbenchBodyProps) {
  const {
    conversations,
    loadingProject,
    loadingConversationId,
    openConversation,
    newConversation: resetConversation,
  } = useProjectSession({
    projectId: project.projectId,
    currentConversationId: project.currentConversationId,
    lastTitleUpdate: project.lastTitleUpdate,
    openProject: project.openProject,
    restoreConversation: project.restoreConversation,
    loadFiles: project.loadFiles,
    runPreview: project.runPreview,
    onToast,
  });

  const newConversation = useCallback(() => {
    resetConversation();
  }, [resetConversation]);

  if (loadingProject) {
    return <WorkbenchSkeleton />;
  }

  return (
    <main className="flex-1 flex min-h-0">
      <ConversationSidebar
        conversations={conversations}
        currentConversationId={project.currentConversationId}
        loadingConversationId={loadingConversationId}
        messages={chat.messages}
        projectId={chat.currentProjectId}
        onNewConversation={newConversation}
        onOpenConversation={openConversation}
        onSend={chat.onSend}
        onResume={chat.onResume}
        onStop={chat.onStop}
      />
      <WorkspacePanels editor={editor} preview={preview} />
    </main>
  );
}
