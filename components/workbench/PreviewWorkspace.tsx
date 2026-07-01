"use client";

import type { RefObject } from "react";
import PreviewPanel from "@/components/preview/PreviewPanel";
import type { PreviewRunPhase } from "@/hooks/usePreview";
import type { Overlay, Status } from "@/lib/types";
import { useWorkbenchStore } from "@/lib/workbenchStore";

type PreviewWorkspaceProps = {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  status: Status;
  overlay: Overlay;
  setOverlay: (updater: Overlay | ((overlay: Overlay) => Overlay)) => void;
  previewActive: boolean;
  previewRunPhase: PreviewRunPhase;
  previewUrl: string | null;
  runLogs: string[];
  canAct: boolean;
  currentProjectId?: string;
  busy: boolean;
  runPreview: (projectId: string) => Promise<unknown>;
};

export default function PreviewWorkspace({
  iframeRef,
  status,
  overlay,
  setOverlay,
  previewActive,
  previewRunPhase,
  previewUrl,
  runLogs,
  canAct,
  currentProjectId,
  busy,
  runPreview,
}: PreviewWorkspaceProps) {
  const viewMode = useWorkbenchStore((state) => state.viewMode);
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);

  function rerunPreview() {
    if (!currentProjectId || busy) return;
    setViewMode("preview");
    requestAnimationFrame(() => {
      void runPreview(currentProjectId);
    });
  }

  return (
    <div className={(viewMode === "preview" ? "flex" : "hidden") + " absolute inset-3 overflow-hidden rounded-xl border border-border"}>
      <PreviewPanel
        iframeRef={iframeRef}
        status={status}
        overlay={overlay}
        setOverlay={setOverlay}
        previewActive={previewActive}
        previewRunPhase={previewRunPhase}
        previewUrl={previewUrl}
        runLogs={runLogs}
        canAct={canAct}
        onRerun={rerunPreview}
      />
    </div>
  );
}
