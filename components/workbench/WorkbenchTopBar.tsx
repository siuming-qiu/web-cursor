"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreviewRunPhase } from "@/hooks/usePreview";
import type { Status } from "@/lib/types";
import { type WorkbenchViewMode, useWorkbenchStore } from "@/lib/workbenchStore";
import TopBar from "@/components/common/TopBar";

type WorkbenchTopBarProps = {
  projectRoute: boolean;
  projName: string;
  previewRunPhase: PreviewRunPhase;
  status: Status;
};

export default function WorkbenchTopBar({
  projectRoute,
  projName,
  previewRunPhase,
  status,
}: WorkbenchTopBarProps) {
  const router = useRouter();
  const viewMode = useWorkbenchStore((state) => state.viewMode);
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);
  const [previewHasUpdate, setPreviewHasUpdate] = useState(false);
  const previousPreviewRunPhaseRef = useRef(previewRunPhase);

  const changeViewMode = useCallback(
    (mode: WorkbenchViewMode) => {
      setViewMode(mode);
      if (mode === "preview") {
        setPreviewHasUpdate(false);
      }
    },
    [setViewMode]
  );

  useEffect(() => {
    const previous = previousPreviewRunPhaseRef.current;
    previousPreviewRunPhaseRef.current = previewRunPhase;
    if (previous === "idle" || previewRunPhase !== "idle") return;
    if (viewMode === "preview") return;
    if (status.kind !== "ok" && status.kind !== "err") return;
    setPreviewHasUpdate(true);
  }, [previewRunPhase, status.kind, viewMode]);

  return (
    <TopBar
      projName={projName}
      viewMode={viewMode}
      previewRunPhase={previewRunPhase}
      previewHasUpdate={previewHasUpdate}
      onViewModeChange={changeViewMode}
      onHome={projectRoute ? () => router.push("/") : undefined}
    />
  );
}
