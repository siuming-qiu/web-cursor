"use client";

import type { RefObject } from "react";
import type { PreviewRunPhase } from "@/hooks/usePreview";
import type { ProjectFileSummary } from "@/lib/projectTypes";
import type { Overlay, Status } from "@/lib/types";
import EditorWorkspace from "@/components/workbench/EditorWorkspace";
import PreviewWorkspace from "@/components/workbench/PreviewWorkspace";

export type EditorWorkspaceModel = {
  code: string;
  files: ProjectFileSummary[];
  activePath?: string;
  hasActiveFileDraft: boolean;
  writing: boolean;
  activeFileSyncing: boolean;
  onChange: (value: string) => void;
  onOpenFile: (path: string) => void;
  onSave: () => void;
  onNewFile: (path: string) => void;
  onRenameFile: (path: string) => void;
  onDeleteFile: () => void;
};

export type PreviewWorkspaceModel = {
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

type WorkspacePanelsProps = {
  editor: EditorWorkspaceModel;
  preview: PreviewWorkspaceModel;
};

export default function WorkspacePanels({
  editor,
  preview,
}: WorkspacePanelsProps) {
  return (
    <div className="relative min-w-0 flex-1 bg-bg p-3">
      <EditorWorkspace
        code={editor.code}
        files={editor.files}
        activePath={editor.activePath}
        hasActiveFileDraft={editor.hasActiveFileDraft}
        writing={editor.writing}
        activeFileSyncing={editor.activeFileSyncing}
        onChange={editor.onChange}
        onOpenFile={editor.onOpenFile}
        onSave={editor.onSave}
        onNewFile={editor.onNewFile}
        onRenameFile={editor.onRenameFile}
        onDeleteFile={editor.onDeleteFile}
      />
      <PreviewWorkspace
        iframeRef={preview.iframeRef}
        status={preview.status}
        overlay={preview.overlay}
        setOverlay={preview.setOverlay}
        previewActive={preview.previewActive}
        previewRunPhase={preview.previewRunPhase}
        previewUrl={preview.previewUrl}
        runLogs={preview.runLogs}
        canAct={preview.canAct}
        currentProjectId={preview.currentProjectId}
        busy={preview.busy}
        runPreview={preview.runPreview}
      />
    </div>
  );
}
