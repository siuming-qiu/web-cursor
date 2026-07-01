/**
 * [INPUT]: optional projectId plus Workbench controller actions for project/chat/files/preview
 * [OUTPUT]: project detail, conversation list, and project-session actions for the workbench layout
 * [POS]: B 域项目会话层 —— 只管理项目详情、会话打开、新会话和会话列表同步
 * [PROTOCOL]: 文件草稿、聊天流和预览执行仍归各自 hook；这里只编排项目/会话入口流程。
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { req } from "@/lib/api";
import type { ProjectDetail, StoredMessage } from "@/lib/projectTypes";
import type { ImageRunView } from "@/lib/types";
import { hasCompleteReactProject } from "@/lib/projectContract";
import { ToolName } from "@/types/tool";

type ProjectRef = {
  id: string;
  title: string;
  files?: ProjectDetail["files"];
};

type TitleUpdate = {
  conversationId: string;
  title: string;
  projectTitle?: string;
};

type UseProjectSessionParams = {
  projectId?: string;
  currentConversationId?: string;
  lastTitleUpdate: TitleUpdate | null;
  openProject: (project: ProjectRef) => void;
  restoreConversation: (project: ProjectRef, conversationId: string, rows: StoredMessage[]) => Promise<void>;
  loadFiles: (projectId: string, preferredPath?: string) => Promise<ProjectDetail["files"]>;
  runPreview: (projectId: string) => Promise<unknown>;
  onToast: (message: string) => void;
};

function assistantToolCallIds(meta: unknown): string[] {
  const toolCalls = (meta as { toolCalls?: { id?: unknown; name?: unknown }[] } | null)?.toolCalls;
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .filter((toolCall) => toolCall.name === ToolName.GenerateImage && typeof toolCall.id === "string")
    .map((toolCall) => toolCall.id as string);
}

function attachImageRuns(rows: StoredMessage[], imageRuns: ImageRunView[]): StoredMessage[] {
  const byToolCallId = new Map<string, ImageRunView[]>();
  for (const run of imageRuns) {
    byToolCallId.set(run.toolCallId, [...(byToolCallId.get(run.toolCallId) ?? []), run]);
  }

  return rows.map((row) => {
    if (row.role !== "assistant") return row;
    const runs = assistantToolCallIds(row.meta).flatMap((toolCallId) => byToolCallId.get(toolCallId) ?? []);
    return runs.length ? { ...row, imageRuns: runs } : row;
  });
}

export function useProjectSession({
  projectId,
  currentConversationId,
  lastTitleUpdate,
  openProject,
  restoreConversation,
  loadFiles,
  runPreview,
  onToast,
}: UseProjectSessionParams) {
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [loadingProject, setLoadingProject] = useState(!!projectId);
  const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null);

  const openConversationForProject = useCallback(
    async (detail: ProjectDetail, conversationId: string) => {
      setLoadingConversationId(conversationId);
      try {
        const [rows, imageRuns] = await Promise.all([
          req<StoredMessage[]>("GET", `/api/conversations/${conversationId}/messages`),
          req<ImageRunView[]>("GET", `/api/conversations/${conversationId}/image-runs`),
        ]);
        await restoreConversation(
          { id: detail.id, title: detail.title },
          conversationId,
          attachImageRuns(rows, imageRuns),
        );
      } catch (e) {
        onToast(String(e instanceof Error ? e.message : e));
      } finally {
        setLoadingConversationId(null);
      }
    },
    [onToast, restoreConversation]
  );

  const loadProject = useCallback(async () => {
    if (!projectId) {
      setLoadingProject(false);
      return;
    }

    setLoadingProject(true);
    try {
      const detail = await req<ProjectDetail>("GET", `/api/projects/${projectId}`);
      setProjectDetail(detail);
      openProject({ id: detail.id, title: detail.title, files: detail.files });
      await loadFiles(detail.id);
      setLoadingProject(false);

      const initialConversationId = detail.conversations[0]?.id;
      if (initialConversationId) {
        await openConversationForProject(detail, initialConversationId);
      } else if (hasCompleteReactProject(detail.files)) {
        void runPreview(detail.id);
      }
    } catch (e) {
      onToast(String(e instanceof Error ? e.message : e));
      setLoadingProject(false);
    }
  }, [loadFiles, onToast, openConversationForProject, openProject, projectId, runPreview]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const openConversation = useCallback(
    async (conversationId: string) => {
      if (!projectDetail) return;
      await openConversationForProject(projectDetail, conversationId);
    },
    [openConversationForProject, projectDetail]
  );

  const newConversation = useCallback(() => {
    if (!projectDetail) return;
    openProject({ id: projectDetail.id, title: projectDetail.title, files: projectDetail.files });
  }, [openProject, projectDetail]);

  useEffect(() => {
    if (!lastTitleUpdate) return;
    setProjectDetail((detail) => detail
      ? {
          ...detail,
          title: lastTitleUpdate.projectTitle ?? detail.title,
          conversations: detail.conversations.map((conversation) =>
            conversation.id === lastTitleUpdate.conversationId
              ? { ...conversation, title: lastTitleUpdate.title }
              : conversation
          ),
        }
      : detail);
  }, [lastTitleUpdate]);

  useEffect(() => {
    if (!projectDetail || !currentConversationId) return;
    if (projectDetail.conversations.some((conversation) => conversation.id === currentConversationId)) return;

    req<ProjectDetail>("GET", `/api/projects/${projectDetail.id}`)
      .then(setProjectDetail)
      .catch((e) => onToast(String(e instanceof Error ? e.message : e)));
  }, [currentConversationId, onToast, projectDetail]);

  return {
    projectDetail,
    conversations: projectDetail?.conversations ?? [],
    loadingProject,
    loadingConversationId,
    openConversation,
    newConversation,
  };
}
