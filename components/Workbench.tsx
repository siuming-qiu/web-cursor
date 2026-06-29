/**
 * [INPUT]: optional projectId from route /p/[projectId]
 * [OUTPUT]: 三栏工作台；有 projectId 时带历史会话栏，无 projectId 时保持一期原始工作台
 * [POS]: B 域工作台容器 —— 组装 useChat、历史会话、编辑器和预览
 * [PROTOCOL]: 历史会话只在项目路由加载；无项目入口直接发 /api/chat 懒建 project/conversation。
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Plus } from "lucide-react";
import { req } from "@/lib/api";
import { useWorkbenchController } from "@/hooks/useWorkbenchController";
import type { ProjectDetail, StoredMessage } from "@/lib/projectTypes";
import { formatTime } from "@/lib/projectTypes";
import { useWorkbenchStore } from "@/lib/workbenchStore";
import TopBar from "@/components/TopBar";
import ChatPanel from "@/components/ChatPanel";
import EditorPanel from "@/components/EditorPanel";
import PreviewPanel from "@/components/PreviewPanel";
import ExportModal from "@/components/ExportModal";
import Toast from "@/components/Toast";

const REQUIRED_PROJECT_FILES = ["package.json", "index.html", "src/main.tsx", "src/App.tsx"] as const;

function hasCompleteReactProject(files: { path: string }[]) {
  const paths = new Set(files.map((file) => file.path));
  return REQUIRED_PROJECT_FILES.every((path) => paths.has(path));
}

function WorkbenchSkeleton() {
  return (
    <main className="flex-1 flex min-h-0">
      <div className="flex h-full w-[380px] flex-none flex-col border-r border-border bg-panel">
        <div className="h-9 border-b border-border px-[14px] flex items-center">
          <div className="h-3 w-20 rounded bg-panel2 animate-pulse" />
        </div>
        <div className="border-b border-border p-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mb-1.5 flex items-center gap-2 rounded-md px-2.5 py-2">
              <div className="h-6 w-6 rounded-md bg-panel2 animate-pulse" />
              <div className="min-w-0 flex-1">
                <div className="h-3 w-28 rounded bg-panel2 animate-pulse" />
                <div className="mt-2 h-2.5 w-20 rounded bg-panel2 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex-1 p-4">
          <div className="h-4 w-40 rounded bg-panel2 animate-pulse" />
          <div className="mt-4 h-16 rounded-lg bg-panel2 animate-pulse" />
          <div className="mt-3 h-12 rounded-lg bg-panel2 animate-pulse" />
        </div>
      </div>
      <div className="flex-[1.05] border-r border-border bg-codebg">
        <div className="h-9 border-b border-border px-[14px] flex items-center">
          <div className="h-3 w-20 rounded bg-panel2 animate-pulse" />
        </div>
        <div className="p-6">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="mb-3 h-3 rounded bg-panel2 animate-pulse" style={{ width: `${80 - i * 7}%` }} />
          ))}
        </div>
      </div>
      <div className="flex-1 bg-panel">
        <div className="h-9 border-b border-border px-[14px] flex items-center">
          <div className="h-3 w-20 rounded bg-panel2 animate-pulse" />
        </div>
        <div className="h-[34px] border-b border-border px-[14px] flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-panel2 animate-pulse" />
          <div className="h-3 w-28 rounded bg-panel2 animate-pulse" />
        </div>
        <div className="flex h-[calc(100%-70px)] items-center justify-center">
          <div className="h-20 w-20 rounded-2xl border border-dashed border-border bg-panel2/40 animate-pulse" />
        </div>
      </div>
    </main>
  );
}

export default function Workbench({ projectId }: { projectId?: string }) {
  const router = useRouter();
  const s = useWorkbenchController();
  const {
    openProject,
    openConversation: restoreConversation,
    loadFiles,
    runPreview,
    currentConversationId,
  } = s;
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [loadingProject, setLoadingProject] = useState(!!projectId);
  const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null);
  const [previewHasUpdate, setPreviewHasUpdate] = useState(false);
  const viewMode = useWorkbenchStore((state) => state.viewMode);
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);
  const initialConversationIdRef = useRef<string | null>(null);
  const initialPreviewProjectIdRef = useRef<string | null>(null);
  const previousPreviewRunPhaseRef = useRef(s.previewRunPhase);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 1900);
  }

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setLoadingProject(true);
    try {
      const detail = await req<ProjectDetail>("GET", `/api/projects/${projectId}`);
      setProjectDetail(detail);
      openProject({ id: detail.id, title: detail.title, files: detail.files });
      await loadFiles(detail.id);
      const initialConversationId = detail.conversations[0]?.id ?? null;
      initialConversationIdRef.current = initialConversationId;
      initialPreviewProjectIdRef.current =
        !initialConversationId && hasCompleteReactProject(detail.files) ? detail.id : null;
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e));
    } finally {
      setLoadingProject(false);
    }
  }, [loadFiles, openProject, projectId, runPreview]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  const openConversation = useCallback(
    async (conversationId: string) => {
      if (!projectDetail) return;
      setLoadingConversationId(conversationId);
      try {
        const rows = await req<StoredMessage[]>("GET", `/api/conversations/${conversationId}/messages`);
        await restoreConversation({ id: projectDetail.id, title: projectDetail.title }, conversationId, rows);
      } catch (e) {
        showToast(String(e instanceof Error ? e.message : e));
      } finally {
        setLoadingConversationId(null);
      }
    },
    [projectDetail, restoreConversation]
  );

  useEffect(() => {
    if (loadingProject || !projectDetail || !initialConversationIdRef.current) return;
    const conversationId = initialConversationIdRef.current;
    initialConversationIdRef.current = null;
    openConversation(conversationId);
  }, [loadingProject, openConversation, projectDetail]);

  useEffect(() => {
    if (loadingProject || !projectDetail || !initialPreviewProjectIdRef.current) return;
    const previewProjectId = initialPreviewProjectIdRef.current;
    initialPreviewProjectIdRef.current = null;
    runPreview(previewProjectId);
  }, [loadingProject, projectDetail, runPreview]);

  useEffect(() => {
    if (viewMode === "preview") {
      setPreviewHasUpdate(false);
    }
  }, [viewMode]);

  useEffect(() => {
    const previous = previousPreviewRunPhaseRef.current;
    previousPreviewRunPhaseRef.current = s.previewRunPhase;
    if (previous === "idle" || s.previewRunPhase !== "idle") return;
    if (viewMode === "preview") return;
    if (s.status.kind !== "ok" && s.status.kind !== "err") return;
    setPreviewHasUpdate(true);
  }, [s.previewRunPhase, s.status.kind, viewMode]);

  useEffect(() => {
    const titleUpdate = s.lastTitleUpdate;
    if (!titleUpdate) return;
    setProjectDetail((detail) => detail
      ? {
          ...detail,
          title: titleUpdate.projectTitle ?? detail.title,
          conversations: detail.conversations.map((conversation) =>
            conversation.id === titleUpdate.conversationId
              ? { ...conversation, title: titleUpdate.title }
              : conversation
          ),
        }
      : detail);
  }, [s.lastTitleUpdate]);

  const newConversation = useCallback(() => {
    if (!projectDetail) return;
    setViewMode("code");
    openProject({ id: projectDetail.id, title: projectDetail.title, files: projectDetail.files });
  }, [openProject, projectDetail]);

  useEffect(() => {
    if (!projectDetail || !currentConversationId) return;
    if (projectDetail.conversations.some((c) => c.id === currentConversationId)) return;

    req<ProjectDetail>("GET", `/api/projects/${projectDetail.id}`)
      .then(setProjectDetail)
      .catch((e) => showToast(String(e instanceof Error ? e.message : e)));
  }, [currentConversationId, projectDetail]);

  const conversations = useMemo(() => projectDetail?.conversations ?? [], [projectDetail]);
  const showHistory = !!projectId;

  const rerunPreview = useCallback(() => {
    const projectId = s.currentProjectId;
    if (!projectId || s.busy) return;
    setViewMode("preview");
    requestAnimationFrame(() => {
      void s.runPreview(projectId);
    });
  }, [s]);

  const openFileInCode = useCallback(
    (path: string) => {
      setViewMode("code");
      s.openFile(path);
    },
    [s]
  );

  const newFileInCode = useCallback((path: string) => {
    setViewMode("code");
    return s.newFile(path);
  }, [s]);

  return (
    <div className="h-screen flex flex-col bg-bg">
      <TopBar
        projName={s.projName}
        canAct={s.hasResult && !s.busy}
        viewMode={viewMode}
        previewRunPhase={s.previewRunPhase}
        previewHasUpdate={previewHasUpdate}
        onViewModeChange={setViewMode}
        onHome={projectId ? () => router.push("/") : undefined}
        onRerun={rerunPreview}
        onExport={() => setExportOpen(true)}
      />

      {loadingProject ? (
        <WorkbenchSkeleton />
      ) : (
        <main className="flex-1 flex min-h-0">
          {showHistory ? (
            <div className="flex h-full w-[380px] flex-none flex-col border-r border-border bg-panel">
              <div className="h-9 flex-none flex items-center justify-between gap-2 px-[14px] border-b border-border text-[12px] text-muted uppercase tracking-[0.06em]">
                <span>对话线索</span>
                <button
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-panel2 px-2.5 text-[12px] text-accent transition hover:border-accent hover:bg-[#1b1713]"
                  onClick={newConversation}
                >
                  <Plus size={14} strokeWidth={2} />
                  新会话
                </button>
              </div>
              <div className="max-h-[160px] flex-none overflow-y-auto border-b border-border p-2">
                {conversations.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] leading-5 text-muted">
                    当前项目还没有历史会话。直接在下方输入，后端会懒建会话。
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {conversations.map((conversation) => {
                      const active = conversation.id === currentConversationId;
                      const loading = conversation.id === loadingConversationId;
                      return (
                        <button
                          key={conversation.id}
                          className={
                            "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition " +
                            (active ? "border-accent bg-[#1b1713]" : "border-transparent hover:bg-panel2")
                          }
                          onClick={() => openConversation(conversation.id)}
                        >
                          <span
                            className={
                              "inline-flex h-6 w-6 flex-none items-center justify-center rounded-md " +
                              (active ? "text-accent" : "text-muted")
                            }
                          >
                            {loading ? (
                              <Loader2 size={14} className="animate-spin" strokeWidth={2} />
                            ) : (
                              <MessageSquare size={14} strokeWidth={1.9} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-fg">{conversation.title || "未命名会话"}</span>
                            <span className="block text-[11px] text-muted">{formatTime(conversation.createdAt)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1">
                <ChatPanel
                  messages={s.messages}
                  projectId={s.currentProjectId}
                  onSend={s.send}
                  onStop={s.stop}
                />
              </div>
            </div>
          ) : (
            <div className="h-full w-[340px] flex-none border-r border-border bg-panel">
              <ChatPanel
                messages={s.messages}
                projectId={s.currentProjectId}
                onSend={s.send}
                onStop={s.stop}
              />
            </div>
          )}

          <div className="relative min-w-0 flex-1 bg-bg p-3">
            <div className={(viewMode === "code" ? "flex" : "hidden") + " absolute inset-3"}>
              <EditorPanel
                code={s.code}
                files={s.files}
                activePath={s.activePath}
                hasActiveFileDraft={s.hasActiveFileDraft}
                writing={s.writing}
                activeFileSyncing={s.activeFileSyncing}
                onChange={s.updateCode}
                onOpenFile={openFileInCode}
                onSave={s.saveActiveFile}
                onNewFile={newFileInCode}
                onRenameFile={s.renameActiveFile}
                onDeleteFile={s.deleteActiveFile}
              />
            </div>
            <div className={(viewMode === "preview" ? "flex" : "hidden") + " absolute inset-3 overflow-hidden rounded-xl border border-border"}>
              <PreviewPanel
                iframeRef={s.iframeRef}
                status={s.status}
                overlay={s.overlay}
                setOverlay={s.setOverlay}
                previewActive={s.previewActive}
                previewRunPhase={s.previewRunPhase}
                canAct={s.hasResult && !s.busy}
                onRerun={rerunPreview}
                onExport={() => setExportOpen(true)}
              />
            </div>
          </div>
        </main>
      )}

      {exportOpen && (
        <ExportModal
          onBuildHtml={s.exportProjectHtml}
          onClose={() => setExportOpen(false)}
          onToast={showToast}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}
