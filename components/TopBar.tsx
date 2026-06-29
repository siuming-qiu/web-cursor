"use client";

import type { PreviewRunPhase } from "@/hooks/usePreview";
import type { WorkbenchViewMode } from "@/lib/workbenchStore";

const btn =
  "px-3 py-1.5 rounded-lg text-[13px] inline-flex items-center gap-1.5 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const btnGhost = `${btn} bg-panel2 border-border text-fg hover:border-accent hover:bg-[#171714]`;
const btnPrimary = `${btn} bg-accent border-accent text-white font-medium hover:bg-[#d04200]`;
const modeBtn =
  "inline-flex h-8 items-center justify-center gap-2 rounded-full px-5 text-[13px] font-medium transition-colors";

export default function TopBar({
  projName,
  canAct,
  viewMode,
  previewRunPhase = "idle",
  previewHasUpdate = false,
  onViewModeChange,
  onHome,
  onRerun,
  onExport,
}: {
  projName: string;
  canAct: boolean;
  viewMode?: WorkbenchViewMode;
  previewRunPhase?: PreviewRunPhase;
  previewHasUpdate?: boolean;
  onViewModeChange?: (mode: WorkbenchViewMode) => void;
  onHome?: () => void;
  onRerun: () => void;
  onExport: () => void;
}) {
  const showModeSwitch = viewMode && onViewModeChange;
  const previewRefreshing = previewRunPhase !== "idle";
  const previewNotified = !previewRefreshing && previewHasUpdate;

  return (
    <div className="h-12 flex-none flex items-center gap-3 px-4 bg-panel border-b border-border">
      <div className="font-semibold tracking-wide flex items-center gap-[7px]">
        <span className="w-[9px] h-[9px] rounded-full bg-accent shadow-[0_0_14px_rgba(245,78,0,0.55)]" />
        Web Cursor
      </div>
      <span className="text-muted text-[13px]">
        {onHome && (
          <button
            className="mr-2 px-2 py-1 rounded-md text-accent hover:bg-panel2"
            onClick={onHome}
          >
            我的项目
          </button>
        )}
        · <b className="text-fg font-medium">{projName}</b>
      </span>
      <div className="flex-1" />
      {showModeSwitch && (
        <div className="flex items-center gap-1 rounded-full border border-border bg-[#050505] p-1">
          <button
            className={
              modeBtn +
              " " +
              (viewMode === "preview" ? "bg-[#1b1713] text-accent shadow-inner" : "text-muted hover:text-fg")
            }
            type="button"
            onClick={() => onViewModeChange("preview")}
          >
            <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center">
              {previewRefreshing && (
                <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-accent opacity-60" />
              )}
              <span
                className={
                  "relative h-2 w-2 rounded-full border transition-all " +
                  (previewRefreshing
                    ? "border-accent bg-accent shadow-[0_0_12px_rgba(245,78,0,0.55)]"
                      : previewNotified
                      ? "border-accent bg-accent shadow-[0_0_10px_rgba(245,78,0,0.55)]"
                    : viewMode === "preview"
                      ? "border-accent bg-accent/70"
                      : "border-muted bg-transparent")
                }
              />
            </span>
            Preview
          </button>
          <button
            className={
              modeBtn +
              " " +
              (viewMode === "code" ? "bg-[#1b1a17] text-fg shadow-inner" : "text-muted hover:text-fg")
            }
            type="button"
            onClick={() => onViewModeChange("code")}
          >
            ⌘ Code
          </button>
        </div>
      )}
      <div className="flex-1" />
      <button className={btnGhost} disabled={!canAct} onClick={onRerun}>
        ↻ 重跑
      </button>
      <button className={btnPrimary} disabled={!canAct} onClick={onExport}>
        ⬇ 导出 HTML
      </button>
    </div>
  );
}
