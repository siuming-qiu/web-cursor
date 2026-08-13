/**
 * [INPUT]: project editor/preview/chat/Git/terminal models
 * [OUTPUT]: VS Code-style activity bar, primary sidebar, editor group, bottom panel, auxiliary Agent sidebar
 * [POS]: B 域项目工作台布局 owner —— 管理区域显隐、侧栏宽度和 tab 选择
 * [PROTOCOL]: source state stays in ProjectRepository; this component only composes stable UI boundaries.
 */
"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Bot, ChevronDown, ChevronLeft, ChevronUp, Files, GitBranch, TerminalSquare, X } from "lucide-react";
import type { Message, SendAttachment } from "@/lib/types";
import type { WebContainerProjectFile } from "@/lib/webcontainer/types";
import { ProjectStorageKind, type ProjectStorageKind as ProjectStorageKindValue } from "@/types/projectStorage";
import ConversationSidebar from "@/components/workbench/ConversationSidebar";
import ProjectExplorer from "@/components/workbench/ProjectExplorer";
import SourceControlPanel, { type SourceControlModel } from "@/components/workbench/SourceControlPanel";
import TerminalPanel from "@/components/workbench/TerminalPanel";
import WorkspacePanels, { type EditorWorkspaceModel, type PreviewWorkspaceModel } from "@/components/workbench/WorkspacePanels";
import type { Conversation } from "@/lib/projectTypes";

const PrimaryView = {
  Explorer: "explorer",
  SourceControl: "source-control",
} as const;

const BottomView = {
  Problems: "problems",
  Output: "output",
  Terminal: "terminal",
} as const;

const Sidebar = {
  Primary: "primary",
  Agent: "agent",
} as const;

const SidebarWidth = {
  Primary: { initial: 260, min: 200, max: 480 },
  Agent: { initial: 380, min: 280, max: 640 },
} as const;

const ACTIVITY_BAR_WIDTH = 48;
const COLLAPSED_AGENT_WIDTH = 40;
const MIN_WORKSPACE_WIDTH = 360;

type SidebarValue = typeof Sidebar[keyof typeof Sidebar];

type SidebarResize = {
  sidebar: SidebarValue;
  pointerId: number;
  startX: number;
  startWidth: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type ChatModel = {
  messages: Message[];
  currentProjectId?: string;
  onSend: (text: string, attachments?: SendAttachment[]) => void;
  onResume: () => void;
  onStop: () => void;
};

export default function VscodeProjectWorkbench({
  conversations,
  currentConversationId,
  loadingConversationId,
  onNewConversation,
  onOpenConversation,
  chat,
  editor,
  preview,
  sourceControl,
  storageKind,
  storageLabel,
  migrationLabel,
  onMigrate,
  readProjectFiles,
}: {
  conversations: Conversation[];
  currentConversationId?: string;
  loadingConversationId: string | null;
  onNewConversation(): void;
  onOpenConversation(conversationId: string): void;
  chat: ChatModel;
  editor: EditorWorkspaceModel;
  preview: PreviewWorkspaceModel;
  sourceControl: SourceControlModel;
  storageKind?: ProjectStorageKindValue;
  storageLabel: string;
  migrationLabel: string;
  onMigrate(): void;
  readProjectFiles(projectId: string): Promise<WebContainerProjectFile[]>;
}) {
  const [primaryView, setPrimaryView] = useState<typeof PrimaryView[keyof typeof PrimaryView]>(PrimaryView.Explorer);
  const [primarySidebarOpen, setPrimarySidebarOpen] = useState(true);
  const [agentSidebarOpen, setAgentSidebarOpen] = useState(true);
  const [primarySidebarWidth, setPrimarySidebarWidth] = useState<number>(SidebarWidth.Primary.initial);
  const [agentSidebarWidth, setAgentSidebarWidth] = useState<number>(SidebarWidth.Agent.initial);
  const [resizingSidebar, setResizingSidebar] = useState<SidebarValue | null>(null);
  const [bottomView, setBottomView] = useState<typeof BottomView[keyof typeof BottomView]>(BottomView.Terminal);
  const [bottomOpen, setBottomOpen] = useState(true);
  const resizeRef = useRef<SidebarResize | null>(null);

  const activityButton = (active: boolean) =>
    "relative grid h-12 w-12 place-items-center transition " +
    (active ? "text-fg" : "text-muted hover:text-fg");

  const selectPrimaryView = (view: typeof PrimaryView[keyof typeof PrimaryView]) => {
    if (primaryView === view) {
      setPrimarySidebarOpen((open) => !open);
      return;
    }
    setPrimaryView(view);
    setPrimarySidebarOpen(true);
  };

  const constrainSidebarWidth = (sidebar: SidebarValue, width: number) => {
    const bounds = sidebar === Sidebar.Primary ? SidebarWidth.Primary : SidebarWidth.Agent;
    const oppositeWidth = sidebar === Sidebar.Primary
      ? (agentSidebarOpen ? agentSidebarWidth : COLLAPSED_AGENT_WIDTH)
      : (primarySidebarOpen ? primarySidebarWidth : 0);
    const availableWidth = window.innerWidth - ACTIVITY_BAR_WIDTH - oppositeWidth - MIN_WORKSPACE_WIDTH;
    return clamp(width, bounds.min, Math.max(bounds.min, Math.min(bounds.max, availableWidth)));
  };

  const setSidebarWidth = (sidebar: SidebarValue, width: number) => {
    const nextWidth = constrainSidebarWidth(sidebar, width);
    if (sidebar === Sidebar.Primary) setPrimarySidebarWidth(nextWidth);
    else setAgentSidebarWidth(nextWidth);
  };

  const startSidebarResize = (sidebar: SidebarValue, event: PointerEvent<HTMLDivElement>) => {
    const startWidth = sidebar === Sidebar.Primary ? primarySidebarWidth : agentSidebarWidth;
    resizeRef.current = { sidebar, pointerId: event.pointerId, startX: event.clientX, startWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingSidebar(sidebar);
    event.preventDefault();
  };

  const resizeSidebar = (event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const pointerDelta = event.clientX - resize.startX;
    const widthDelta = resize.sidebar === Sidebar.Primary ? pointerDelta : -pointerDelta;
    setSidebarWidth(resize.sidebar, resize.startWidth + widthDelta);
  };

  const stopSidebarResize = (event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeRef.current = null;
    setResizingSidebar(null);
  };

  const resizeSidebarWithKeyboard = (sidebar: SidebarValue, event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const widthDelta = sidebar === Sidebar.Primary ? direction * 16 : direction * -16;
    const width = sidebar === Sidebar.Primary ? primarySidebarWidth : agentSidebarWidth;
    setSidebarWidth(sidebar, width + widthDelta);
    event.preventDefault();
  };

  const terminalActive = bottomOpen && bottomView === BottomView.Terminal;
  return (
    <div className={"flex min-h-0 flex-1 flex-col bg-bg " + (resizingSidebar ? "select-none cursor-col-resize" : "")}>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-12 flex-none flex-col items-center border-r border-border bg-[#171714]" aria-label="Activity Bar">
          <button
            type="button"
            className={activityButton(primarySidebarOpen && primaryView === PrimaryView.Explorer)}
            title="Explorer"
            aria-label="Explorer"
            aria-pressed={primarySidebarOpen && primaryView === PrimaryView.Explorer}
            onClick={() => selectPrimaryView(PrimaryView.Explorer)}
          >
            {primarySidebarOpen && primaryView === PrimaryView.Explorer && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
            <Files size={22} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className={activityButton(primarySidebarOpen && primaryView === PrimaryView.SourceControl)}
            title="Source Control"
            aria-label="Source Control"
            aria-pressed={primarySidebarOpen && primaryView === PrimaryView.SourceControl}
            onClick={() => selectPrimaryView(PrimaryView.SourceControl)}
          >
            {primarySidebarOpen && primaryView === PrimaryView.SourceControl && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
            <GitBranch size={22} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className={"mt-auto " + activityButton(agentSidebarOpen)}
            title={agentSidebarOpen ? "收起 Agent 侧边栏" : "展开 Agent 侧边栏"}
            aria-label={agentSidebarOpen ? "收起 Agent 侧边栏" : "展开 Agent 侧边栏"}
            aria-pressed={agentSidebarOpen}
            onClick={() => setAgentSidebarOpen((open) => !open)}
          >
            {agentSidebarOpen && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
            <Bot size={21} strokeWidth={1.7} />
          </button>
        </nav>

        <div
          className={
            "relative flex-none overflow-hidden " +
            (resizingSidebar === Sidebar.Primary ? "" : "transition-[width] duration-200 ease-out")
          }
          style={{ width: primarySidebarOpen ? primarySidebarWidth : 0 }}
        >
          <aside
            className={
              "h-full border-r border-border bg-panel transition-[opacity,transform] duration-200 ease-out " +
              (primarySidebarOpen ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0 pointer-events-none")
            }
            style={{ width: primarySidebarWidth }}
            aria-hidden={!primarySidebarOpen}
            inert={!primarySidebarOpen}
          >
            {primaryView === PrimaryView.Explorer ? (
              <ProjectExplorer
                files={editor.files}
                activePath={editor.activePath}
                onOpenFile={editor.onOpenFile}
                onNewFile={editor.onNewFile}
                onCollapse={() => setPrimarySidebarOpen(false)}
              />
            ) : (
              <SourceControlPanel
                model={sourceControl}
                onMigrate={onMigrate}
                onCollapse={() => setPrimarySidebarOpen(false)}
              />
            )}
          </aside>
          {primarySidebarOpen && (
            <div
              role="separator"
              aria-label="调整左侧栏宽度"
              aria-orientation="vertical"
              aria-valuemin={SidebarWidth.Primary.min}
              aria-valuemax={SidebarWidth.Primary.max}
              aria-valuenow={primarySidebarWidth}
              tabIndex={0}
              className="group absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none outline-none"
              onPointerDown={(event) => startSidebarResize(Sidebar.Primary, event)}
              onPointerMove={resizeSidebar}
              onPointerUp={stopSidebarResize}
              onPointerCancel={stopSidebarResize}
              onKeyDown={(event) => resizeSidebarWithKeyboard(Sidebar.Primary, event)}
            >
              <span className="absolute inset-y-0 right-0 w-0.5 bg-transparent transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
            </div>
          )}
        </div>

        <section className="flex min-w-0 flex-1 flex-col bg-bg">
          <div className="min-h-0 flex-1">
            <WorkspacePanels editor={editor} preview={preview} compact />
          </div>
          <section className={(bottomOpen ? "h-[230px]" : "h-9") + " flex-none border-t border-border bg-[#11110f]"}>
            <div className="flex h-9 items-center border-b border-border bg-panel px-2">
              {Object.values(BottomView).map((view) => (
                <button
                  key={view}
                  type="button"
                  className={
                    "h-9 border-b-2 px-3 text-[11px] uppercase tracking-[0.06em] transition " +
                    (bottomOpen && bottomView === view ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")
                  }
                  onClick={() => {
                    setBottomView(view);
                    setBottomOpen(true);
                  }}
                >
                  {view}
                </button>
              ))}
              <div className="ml-auto flex items-center">
                <button
                  type="button"
                  className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-panel2 hover:text-fg"
                  aria-label={bottomOpen ? "收起底部面板" : "展开底部面板"}
                  onClick={() => setBottomOpen((open) => !open)}
                >
                  {bottomOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
                <button
                  type="button"
                  className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-panel2 hover:text-fg"
                  aria-label="关闭底部面板"
                  onClick={() => setBottomOpen(false)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            {bottomOpen && (
              <div className="h-[calc(100%-2.25rem)] min-h-0">
                {bottomView === BottomView.Terminal && (
                  <TerminalPanel active={terminalActive} projectId={chat.currentProjectId} readProjectFiles={readProjectFiles} />
                )}
                {bottomView === BottomView.Output && (
                  <pre className="h-full overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-5 text-muted">
                    {preview.runLogs.join("") || "尚无 Preview 输出。"}
                  </pre>
                )}
                {bottomView === BottomView.Problems && (
                  <div className="h-full overflow-auto px-3 py-2 text-xs text-muted">
                    {preview.overlay.show ? preview.overlay.message : "没有检测到问题。"}
                  </div>
                )}
              </div>
            )}
          </section>
        </section>

        <div
          className={
            "relative flex-none overflow-hidden bg-panel " +
            (resizingSidebar === Sidebar.Agent ? "" : "transition-[width] duration-200 ease-out") +
            (agentSidebarOpen ? "" : " border-l border-border")
          }
          style={{ width: agentSidebarOpen ? agentSidebarWidth : COLLAPSED_AGENT_WIDTH }}
        >
          <div
            className={
              "absolute inset-y-0 right-0 transition-[opacity,transform] duration-200 ease-out " +
              (agentSidebarOpen ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0 pointer-events-none")
            }
            style={{ width: agentSidebarWidth }}
            aria-hidden={!agentSidebarOpen}
            inert={!agentSidebarOpen}
          >
            <ConversationSidebar
              placement="right"
              conversations={conversations}
              currentConversationId={currentConversationId}
              loadingConversationId={loadingConversationId}
              messages={chat.messages}
              projectId={chat.currentProjectId}
              onNewConversation={onNewConversation}
              onOpenConversation={onOpenConversation}
              onSend={chat.onSend}
              onResume={chat.onResume}
              onStop={chat.onStop}
              onCollapse={() => setAgentSidebarOpen(false)}
            />
          </div>
          {agentSidebarOpen && (
            <div
              role="separator"
              aria-label="调整右侧栏宽度"
              aria-orientation="vertical"
              aria-valuemin={SidebarWidth.Agent.min}
              aria-valuemax={SidebarWidth.Agent.max}
              aria-valuenow={agentSidebarWidth}
              tabIndex={0}
              className="group absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize touch-none outline-none"
              onPointerDown={(event) => startSidebarResize(Sidebar.Agent, event)}
              onPointerMove={resizeSidebar}
              onPointerUp={stopSidebarResize}
              onPointerCancel={stopSidebarResize}
              onKeyDown={(event) => resizeSidebarWithKeyboard(Sidebar.Agent, event)}
            >
              <span className="absolute inset-y-0 left-0 w-0.5 bg-transparent transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
            </div>
          )}
          {!agentSidebarOpen && (
            <button
              type="button"
              className="absolute right-0 top-2 grid h-9 w-10 place-items-center text-muted transition-colors hover:bg-panel2 hover:text-fg"
              aria-label="展开 Agent 侧边栏"
              title="展开 Agent 侧边栏"
              onClick={() => setAgentSidebarOpen(true)}
            >
              <ChevronLeft size={17} />
            </button>
          )}
        </div>
      </div>
      <footer className="flex h-6 flex-none items-center gap-3 bg-accent px-3 text-[11px] text-white">
        <span className="inline-flex items-center gap-1"><GitBranch size={12} /> {storageKind === ProjectStorageKind.BrowserGit ? "Git" : "No Git"}</span>
        <span>{storageLabel}</span>
        {storageKind === ProjectStorageKind.Database && (
          <button
            type="button"
            className="rounded bg-white/15 px-2 py-0.5 font-semibold hover:bg-white/25"
            onClick={onMigrate}
          >
            {migrationLabel}
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-1"><TerminalSquare size={12} /> WebContainer</span>
      </footer>
    </div>
  );
}
