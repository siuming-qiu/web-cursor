/**
 * [INPUT]: project id + project_files REST API
 * [OUTPUT]: 文件列表、当前文件草稿、新建/保存/重命名/删除/readProjectFiles
 * [POS]: B 域文件编辑状态 —— 只管理用户手动编辑，不处理 chat/messages
 * [PROTOCOL]: activeFileDraftContent 是前端临时草稿；只有 saveActiveFile 写回 project_files。
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { req } from "@/lib/api";
import {
  FileContentAction,
  type ProjectFileContent,
  type ProjectFileSummary,
} from "@/lib/projectTypes";
import { APP_ENTRY_PATH, hasCompleteReactProject } from "@/lib/projectContract";
import type { WebContainerProjectFile } from "@/lib/webcontainer/types";
import { ChatEventType, type ChatEvent } from "@/types/chat";

type FilesWithContentResponse = {
  files: ProjectFileContent[];
};

type ProjectRef = {
  id: string;
  files?: ProjectFileSummary[];
};

export type PersistedFileChange = {
  projectId: string;
  operation: "write" | "delete" | "rename";
  path: string;
  oldPath?: string;
  sync?: Promise<void>;
};

function chooseFile(files: ProjectFileSummary[], preferredPath?: string) {
  if (preferredPath && files.some((file) => file.path === preferredPath)) return preferredPath;
  if (files.some((file) => file.path === APP_ENTRY_PATH)) return APP_ENTRY_PATH;
  return files[0]?.path;
}

export function useProjectFiles() {
  const projectIdRef = useRef<string | undefined>(undefined);
  const activePathRef = useRef<string | undefined>(undefined);
  const hasActiveFileDraftRef = useRef(false);
  const fileContentsRef = useRef(new Map<string, string>());

  const [files, setFiles] = useState<ProjectFileSummary[]>([]);
  const [activePath, setActivePath] = useState<string | undefined>(undefined);
  const [activeFileDraftContent, setActiveFileDraftContent] = useState("");
  const [hasActiveFileDraft, setHasActiveFileDraft] = useState(false);
  const [activeFileSyncing, setActiveFileSyncing] = useState(false);

  const markActiveFileSaved = useCallback(() => {
    hasActiveFileDraftRef.current = false;
    setHasActiveFileDraft(false);
  }, []);

  const confirmDiscardActiveFileDraft = useCallback(() => {
    return !hasActiveFileDraftRef.current || window.confirm("当前文件有未保存草稿，继续操作会丢弃这些改动。");
  }, []);

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

  const refreshFileSummaries = useCallback(async (projectId: string) => {
    const response = await req<FilesWithContentResponse>(
      "GET",
      `/api/projects/${projectId}/files?includeContent=1`
    );
    for (const file of response.files) {
      if (!hasActiveFileDraftRef.current || file.path !== activePathRef.current) {
        fileContentsRef.current.set(file.path, file.content);
      }
    }
    const summaries = response.files.map(({ content: _content, ...summary }) => summary);
    setFiles(summaries);
    return summaries;
  }, []);

  const openFile = useCallback(
    (path: string) => {
      if (path !== activePathRef.current && !confirmDiscardActiveFileDraft()) return;
      if (!fileContentsRef.current.has(path)) return;

      activePathRef.current = path;
      setActivePath(path);
      setActiveFileDraftContent(fileContentsRef.current.get(path) ?? "");
      markActiveFileSaved();
    },
    [confirmDiscardActiveFileDraft, markActiveFileSaved]
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
        setActiveFileDraftContent("");
        markActiveFileSaved();
      }

      return nextFiles;
    },
    [loadProjectFileContents, markActiveFileSaved, openFile]
  );

  const readProjectFiles = useCallback(
    async (projectId: string): Promise<WebContainerProjectFile[]> => {
      if (fileContentsRef.current.size === 0) {
        await loadProjectFileContents(projectId);
      }
      return [...fileContentsRef.current.entries()].map(([path, content]) => ({ path, content }));
    },
    [loadProjectFileContents]
  );

  const syncFileChange = useCallback(
    async (ev: Extract<ChatEvent, { type: typeof ChatEventType.FilesChanged }>): Promise<PersistedFileChange | null> => {
      const projectId = projectIdRef.current;
      if (!projectId || !ev.path || !ev.operation) return null;

      const nextFiles = await loadProjectFileContents(projectId);
      if (ev.operation === "delete") {
        const nextPath = chooseFile(nextFiles, APP_ENTRY_PATH);
        if (nextPath) openFile(nextPath);
        else {
          activePathRef.current = undefined;
          setActivePath(undefined);
          setActiveFileDraftContent("");
          markActiveFileSaved();
        }
        return { projectId, operation: "delete", path: ev.path };
      }

      openFile(ev.path);
      return {
        projectId,
        operation: ev.operation,
        path: ev.path,
        oldPath: ev.oldPath,
      };
    },
    [loadProjectFileContents, markActiveFileSaved, openFile]
  );

  const setProjectFiles = useCallback((project: ProjectRef) => {
    projectIdRef.current = project.id;
    activePathRef.current = undefined;
    setFiles(project.files ?? []);
    setActivePath(undefined);
    setActiveFileDraftContent("");
    markActiveFileSaved();
  }, [markActiveFileSaved]);

  const updateActiveFileDraft = useCallback((value: string) => {
    setActiveFileDraftContent(value);
    hasActiveFileDraftRef.current = true;
    setHasActiveFileDraft(true);
  }, []);

  const saveActiveFile = useCallback(async () => {
    const projectId = projectIdRef.current;
    const path = activePathRef.current;
    if (!projectId || !path || !hasActiveFileDraftRef.current) return null;

    const previousSavedContent = fileContentsRef.current.get(path) ?? "";
    const optimisticContent = activeFileDraftContent;
    fileContentsRef.current.set(path, optimisticContent);
    markActiveFileSaved();
    setActiveFileSyncing(true);

    const sync = req<ProjectFileContent>("POST", `/api/projects/${projectId}/files/content`, {
      action: FileContentAction.Write,
      path,
      content: optimisticContent,
    })
      .then(async () => {
        await refreshFileSummaries(projectId);
      })
      .catch((error) => {
        fileContentsRef.current.set(path, previousSavedContent);
        if (activePathRef.current === path) {
          setActiveFileDraftContent(optimisticContent);
          hasActiveFileDraftRef.current = true;
          setHasActiveFileDraft(true);
        }
        throw error;
      })
      .finally(() => {
        setActiveFileSyncing(false);
      });

    return { projectId, operation: "write", path, sync } satisfies PersistedFileChange;
  }, [activeFileDraftContent, markActiveFileSaved, refreshFileSummaries]);

  const newFile = useCallback(async (path: string) => {
    const projectId = projectIdRef.current;
    if (!projectId) throw new Error("请先发送一次需求创建项目，再新建文件。");
    if (!confirmDiscardActiveFileDraft()) return null;

    setActiveFileSyncing(true);
    try {
      await req<ProjectFileContent>("POST", `/api/projects/${projectId}/files/content`, {
        action: FileContentAction.Write,
        path,
        content: "",
      });
      markActiveFileSaved();
      await loadFiles(projectId, path);
      return { projectId, operation: "write", path } satisfies PersistedFileChange;
    } finally {
      setActiveFileSyncing(false);
    }
  }, [confirmDiscardActiveFileDraft, loadFiles, markActiveFileSaved]);

  const renameActiveFile = useCallback(async (newPath: string) => {
    const projectId = projectIdRef.current;
    const oldPath = activePathRef.current;
    if (!projectId || !oldPath || !newPath || newPath === oldPath) return null;
    if (!confirmDiscardActiveFileDraft()) return null;

    setActiveFileSyncing(true);
    try {
      await req<ProjectFileSummary>("POST", `/api/projects/${projectId}/files/rename`, { oldPath, newPath });
      markActiveFileSaved();
      await loadFiles(projectId, newPath);
      return { projectId, operation: "rename", path: newPath, oldPath } satisfies PersistedFileChange;
    } finally {
      setActiveFileSyncing(false);
    }
  }, [confirmDiscardActiveFileDraft, loadFiles, markActiveFileSaved]);

  const deleteActiveFile = useCallback(async () => {
    const projectId = projectIdRef.current;
    const path = activePathRef.current;
    if (!projectId || !path) return null;
    if (!confirmDiscardActiveFileDraft()) return null;

    setActiveFileSyncing(true);
    try {
      await req<{ ok: true; path: string }>("POST", `/api/projects/${projectId}/files/content`, {
        action: FileContentAction.Delete,
        path,
      });
      markActiveFileSaved();
      await loadFiles(projectId, APP_ENTRY_PATH);
      return { projectId, operation: "delete", path } satisfies PersistedFileChange;
    } finally {
      setActiveFileSyncing(false);
    }
  }, [confirmDiscardActiveFileDraft, loadFiles, markActiveFileSaved]);

  return {
    files,
    activePath,
    activeFileDraftContent,
    hasActiveFileDraft,
    activeFileSyncing,
    hasCompleteReactProject,
    setProjectFiles,
    loadFiles,
    syncFileChange,
    readProjectFiles,
    openFile,
    updateActiveFileDraft,
    saveActiveFile,
    newFile,
    renameActiveFile,
    deleteActiveFile,
  };
}
