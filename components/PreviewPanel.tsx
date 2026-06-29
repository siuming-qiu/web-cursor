"use client";

import type { RefObject } from "react";
import { RUNNER_HTML } from "@/lib/sandbox/runner";
import type { Status, Overlay } from "@/lib/types";
import type { PreviewRunPhase } from "@/hooks/usePreview";

const LED: Record<Status["kind"], string> = {
  "": "bg-[#3a3832]",
  load: "bg-accent animate-pulse",
  ok: "bg-green shadow-[0_0_8px_#3fb950]",
  err: "bg-red shadow-[0_0_8px_#f85149]",
};
const TEXT: Record<Status["kind"], string> = {
  "": "text-fg",
  load: "text-accent",
  ok: "text-[#7ee787]",
  err: "text-[#ff9c96]",
};
const obtn = "bg-panel2 border border-border text-fg px-3.5 py-[7px] rounded-lg text-[13px] hover:border-accent";
const toolBtn =
  "h-7 rounded-md border border-border bg-panel2 px-2.5 text-[12px] text-fg transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45";

export default function PreviewPanel({
  iframeRef,
  status,
  overlay,
  setOverlay,
  previewActive,
  previewRunPhase,
  canAct,
  onRerun,
  onExport,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  status: Status;
  overlay: Overlay;
  setOverlay: (fn: (o: Overlay) => Overlay) => void;
  previewActive: boolean;
  previewRunPhase: PreviewRunPhase;
  canAct: boolean;
  onRerun: () => void;
  onExport: () => void;
}) {
  const refreshing = previewRunPhase !== "idle";
  const refreshingText: Record<PreviewRunPhase, string> = {
    idle: "",
    reading: "正在读取项目文件",
    compiling: "正在编译项目",
    running: "正在刷新预览",
  };

  return (
    <div className="grid min-w-0 h-full flex-1 grid-rows-[42px_39px_minmax(0,1fr)] bg-panel">
      <div className="flex flex-none items-center justify-between gap-3 border-b border-border px-4 text-[12px] text-muted">
        <div className="min-w-0">
          <div className="font-semibold text-[13px] tracking-wide text-fg">Preview</div>
        </div>
        <span className="text-[12px] font-semibold text-muted">iframe 沙箱结果</span>
      </div>

      <div className={"flex flex-none items-center gap-3 border-b border-border bg-panel2 px-4 text-[12.5px] " + TEXT[status.kind]}>
        <span className={"h-[9px] w-[9px] shrink-0 rounded-full " + LED[status.kind]} />
        <span className="shrink-0 font-medium">{status.text || "等待渲染"}</span>
        {status.meta && <span className="text-muted text-[11.5px]">{status.meta}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button className={toolBtn} type="button" disabled={!canAct} onClick={onRerun}>
            ↻ 重新运行
          </button>
          <button className={toolBtn + " border-accent text-accent"} type="button" disabled={!canAct} onClick={onExport}>
            ↓ 导出 HTML
          </button>
        </div>
      </div>

      <div className="relative min-h-0 overflow-hidden bg-panel p-3">
        {!previewActive && (
          <div className="absolute inset-3 z-[1] flex flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-border bg-panel2 text-muted">
            <div className="flex h-16 w-16 items-center justify-center rounded-[12px] border-2 border-dashed border-border bg-codebg text-[26px]">
              ⌨
            </div>
            生成后在这里预览
          </div>
        )}

        <iframe
          id="preview"
          ref={iframeRef}
          sandbox="allow-scripts"
          srcDoc={RUNNER_HTML}
          title="preview"
          className={
            "block h-full w-full rounded-lg border border-border bg-white transition " +
            (refreshing ? "opacity-45 blur-[1px]" : "opacity-100")
          }
        />

        {refreshing && (
          <div className="absolute inset-3 z-[2] flex items-center justify-center rounded-lg bg-black/45 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 rounded-lg border border-accent bg-panel/95 px-3.5 py-2 text-[12.5px] font-medium text-accent">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#3a3832] border-t-accent" />
              {refreshingText[previewRunPhase]}
            </div>
          </div>
        )}

        {overlay.show && (
          <div className="absolute inset-3 z-[2] flex flex-col overflow-auto rounded-lg border border-border bg-bg/[0.92] p-[22px] backdrop-blur-[2px]">
            <span className="inline-flex items-center gap-[7px] text-red font-bold text-[13px] mb-3">⚠ Runtime Error</span>
            <div className="font-mono text-[14px] text-[#ff9c96] bg-red/10 border border-red/30 rounded-lg px-[13px] py-[11px] leading-[1.5] whitespace-pre-wrap">
              {overlay.message}
            </div>
            {overlay.showStack && overlay.stack && (
              <div className="font-mono text-[12px] text-muted mt-3 leading-[1.7] whitespace-pre-wrap">{overlay.stack}</div>
            )}
            <div className="mt-auto flex gap-[9px] pt-4">
              {overlay.stack && (
                <button className={obtn} onClick={() => setOverlay((o) => ({ ...o, showStack: !o.showStack }))}>
                  {overlay.showStack ? "收起详情" : "查看详情"}
                </button>
              )}
              <button
                className="bg-panel2 border border-yellow text-yellow px-3.5 py-[7px] rounded-lg text-[13px]"
                onClick={() => setOverlay((o) => ({ ...o, show: false }))}
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
