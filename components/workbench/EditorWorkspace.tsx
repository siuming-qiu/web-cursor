"use client";

import EditorPanel from "@/components/editor/EditorPanel";
import type { ProjectFileSummary } from "@/lib/projectTypes";
import { useWorkbenchStore } from "@/lib/workbenchStore";

type EditorWorkspaceProps = {
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

export default function EditorWorkspace({
  code,
  files,
  activePath,
  hasActiveFileDraft,
  writing,
  activeFileSyncing,
  onChange,
  onOpenFile,
  onSave,
  onNewFile,
  onRenameFile,
  onDeleteFile,
}: EditorWorkspaceProps) {
  const viewMode = useWorkbenchStore((state) => state.viewMode);
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);

  function openFileInCode(path: string) {
    setViewMode("code");
    onOpenFile(path);
  }

  function newFileInCode(path: string) {
    setViewMode("code");
    onNewFile(path);
  }

  return (
    <div className={(viewMode === "code" ? "flex" : "hidden") + " absolute inset-3"}>
      <EditorPanel
        code={code}
        files={files}
        activePath={activePath}
        hasActiveFileDraft={hasActiveFileDraft}
        writing={writing}
        activeFileSyncing={activeFileSyncing}
        onChange={onChange}
        onOpenFile={openFileInCode}
        onSave={onSave}
        onNewFile={newFileInCode}
        onRenameFile={onRenameFile}
        onDeleteFile={onDeleteFile}
      />
    </div>
  );
}
