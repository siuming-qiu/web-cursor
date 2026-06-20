"use client";

import type { RefObject } from "react";
import { RUNNER_HTML } from "@/lib/sandbox/runner";
import type { Status, Overlay } from "@/lib/types";

const LED: Record<Status["kind"], string> = {
  "": "bg-[#3a4150]",
  load: "bg-accent animate-pulse",
  ok: "bg-green shadow-[0_0_8px_#3fb950]",
  err: "bg-red shadow-[0_0_8px_#f85149]",
};
const TEXT: Record<Status["kind"], string> = {
  "": "text-fg",
  load: "text-[#9dc7ff]",
  ok: "text-[#7ee787]",
  err: "text-[#ff9c96]",
};
const obtn = "bg-panel2 border border-border text-fg px-3.5 py-[7px] rounded-lg text-[13px] hover:border-accent";

export default function PreviewPanel({
  iframeRef,
  status,
  overlay,
  setOverlay,
  previewActive,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  status: Status;
  overlay: Overlay;
  setOverlay: (fn: (o: Overlay) => Overlay) => void;
  previewActive: boolean;
}) {
  return (
    <div className="flex flex-col min-w-0 h-full flex-1 bg-panel">
      <div className="h-9 flex-none flex items-center gap-2 px-[14px] border-b border-border text-[12px] text-muted uppercase tracking-[0.06em]">
        <span>🖥</span> 实时预览
      </div>

      <div className={"h-[34px] flex-none flex items-center gap-[9px] px-[14px] border-b border-border text-[12.5px] bg-panel " + TEXT[status.kind]}>
        <span className={"w-[9px] h-[9px] rounded-full " + LED[status.kind]} />
        <span>{status.text}</span>
        <span className="text-muted ml-auto text-[11.5px]">{status.meta}</span>
      </div>

      <div className="flex-1 relative bg-white min-h-0">
        {!previewActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-muted bg-panel z-[1]">
            <div className="w-16 h-16 border-2 border-dashed border-[#30363d] rounded-[14px] flex items-center justify-center text-[26px]">
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
          className="w-full h-full border-none bg-white block"
        />

        {overlay.show && (
          <div className="absolute inset-0 bg-bg/[0.92] backdrop-blur-[2px] flex flex-col p-[22px] overflow-auto z-[2]">
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
