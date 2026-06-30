"use client";

import dynamic from "next/dynamic";
import { FormEvent, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FileCode2, FilePlus2, Folder, PencilLine, Save, Trash2, X } from "lucide-react";
import Spinner from "./Spinner";
import type { ProjectFileSummary } from "@/lib/projectTypes";

const CodeEditor = dynamic(() => import("./CodeEditor"), { ssr: false });

type FileGroup = {
  dir: string;
  files: ProjectFileSummary[];
};

function fileName(path: string) {
  return path.split("/").at(-1) ?? path;
}

function dirName(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function groupFiles(files: ProjectFileSummary[]): FileGroup[] {
  const groups = new Map<string, ProjectFileSummary[]>();
  for (const file of files) {
    const dir = dirName(file.path);
    groups.set(dir, [...(groups.get(dir) ?? []), file]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, rows]) => ({
      dir,
      files: rows.toSorted((a, b) => a.path.localeCompare(b.path)),
    }));
}

const iconBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-panel2 text-[13px] text-muted transition hover:border-accent hover:text-accent disabled:opacity-40";

type FileDialog =
  | { kind: "new"; path: string; error: string }
  | { kind: "rename"; path: string; error: string }
  | { kind: "delete"; path: string; error: string }
  | null;

function normalizeInputPath(path: string) {
  return path.trim();
}

export default function EditorPanel({
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
}: {
  code: string;
  files: ProjectFileSummary[];
  activePath?: string;
  hasActiveFileDraft: boolean;
  writing: boolean;
  activeFileSyncing: boolean;
  onChange: (value: string) => void;
  onOpenFile: (path: string) => void;
  onSave: () => void;
  onNewFile: (path: string) => void | Promise<void>;
  onRenameFile: (newPath: string) => void | Promise<void>;
  onDeleteFile: () => void | Promise<void>;
}) {
  const t = useTranslations("Editor");
  const common = useTranslations("Common");
  const groups = useMemo(() => groupFiles(files), [files]);
  const canEdit = !!activePath;
  const [dialog, setDialog] = useState<FileDialog>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;

    const path = normalizeInputPath(dialog.path);
    if (dialog.kind !== "delete" && !path) {
      setDialog({ ...dialog, error: t("inputPathRequired") });
      return;
    }

    setSubmitting(true);
    try {
      if (dialog.kind === "new") await onNewFile(path);
      if (dialog.kind === "rename") await onRenameFile(path);
      if (dialog.kind === "delete") await onDeleteFile();
      setDialog(null);
    } catch (error) {
      setDialog({
        ...dialog,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  function fileDialogTitle(dialog: Exclude<FileDialog, null>) {
    if (dialog.kind === "new") return t("newFile");
    if (dialog.kind === "rename") return t("renameOrMove");
    return t("deleteFile");
  }

  function fileDialogAction(dialog: Exclude<FileDialog, null>) {
    if (dialog.kind === "new") return t("create");
    if (dialog.kind === "rename") return t("apply");
    return common("delete");
  }

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-codebg">
      <aside className="flex h-full w-[270px] flex-none flex-col border-r border-border bg-panel">
        <div className="h-11 flex-none flex items-center justify-between gap-2 border-b border-border bg-panel2 px-3.5 text-[12px] uppercase tracking-[0.08em] text-muted">
          <span>{t("files")}</span>
          <span className="ml-auto rounded bg-codebg px-2 py-0.5 text-[11px] tracking-normal text-muted">{files.length}</span>
          <button
            className={iconBtn}
            onClick={() => setDialog({ kind: "new", path: "src/components/NewFile.tsx", error: "" })}
            title={t("newFile")}
          >
            <FilePlus2 size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
          {groups.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] leading-5 text-muted">
              {t("emptyFiles")}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <div key={group.dir || "__root"}>
                  {group.dir && (
                    <div className="mb-1.5 flex items-center gap-1.5 px-1.5 text-[11px] uppercase tracking-[0.06em] text-muted">
                      <Folder size={12} strokeWidth={1.8} className="text-muted" />
                      <span className="truncate">{group.dir}</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    {group.files.map((file) => {
                      const active = file.path === activePath;
                      return (
                        <button
                          key={file.path}
                          className={
                            "flex h-8 items-center gap-2 rounded-md border px-2.5 text-left text-[12.5px] transition " +
                            (active
                              ? "border-accent bg-[#1b1713] text-fg shadow-[inset_3px_0_0_#f54e00]"
                              : "border-transparent text-muted hover:bg-panel2 hover:text-fg")
                          }
                          onClick={() => onOpenFile(file.path)}
                          title={file.path}
                        >
                          <FileCode2 size={13} strokeWidth={1.8} className={active ? "text-accent" : "text-muted"} />
                          <span className="min-w-0 flex-1 truncate">{fileName(file.path)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="flex h-full min-w-0 flex-1 flex-col bg-[#11110f]">
        <div className="h-11 flex-none flex items-center gap-2 border-b border-border bg-panel px-3 text-[12px] text-muted">
          <div
            className={
              "flex h-full min-w-0 max-w-[520px] items-center gap-2 border-t-2 bg-panel2 px-3 " +
              (hasActiveFileDraft ? "border-yellow" : "border-accent")
            }
            title={hasActiveFileDraft && activePath ? `${activePath} - ${t("unsavedDraft")}` : activePath ?? t("noFile")}
          >
            <FileCode2 size={14} strokeWidth={1.8} className="text-accent" />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">{activePath ?? t("noFile")}</span>
            {hasActiveFileDraft && (
              <span
                className="h-2 w-2 flex-none rounded-full bg-yellow shadow-[0_0_0_2px_rgba(210,153,34,0.12)]"
                aria-label={t("unsaved")}
              />
            )}
          </div>
          <div className="flex-1" />
          {writing && (
            <span className="inline-flex items-center gap-1.5 rounded bg-codebg/80 px-2 py-[3px] text-[11px] text-accent">
              <Spinner /> {t("aiWriting")}
            </span>
          )}
          {activeFileSyncing && (
            <span className="inline-flex items-center gap-1.5 rounded bg-codebg/80 px-2 py-[3px] text-[11px] text-accent">
              <Spinner /> {t("syncing")}
            </span>
          )}
          <button
            className={iconBtn}
            disabled={!canEdit || activeFileSyncing}
            onClick={() => activePath && setDialog({ kind: "rename", path: activePath, error: "" })}
            title={t("renameOrMove")}
          >
            <PencilLine size={14} strokeWidth={2} />
          </button>
          <button
            className={iconBtn}
            disabled={!canEdit || activeFileSyncing}
            onClick={() => activePath && setDialog({ kind: "delete", path: activePath, error: "" })}
            title={t("deleteFile")}
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
          <button
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-accent bg-accent px-2.5 text-[12px] font-medium text-white transition hover:bg-[#d04200] disabled:opacity-40"
            disabled={!canEdit || !hasActiveFileDraft}
            onClick={onSave}
          >
            <Save size={13} strokeWidth={2.2} />
            {common("save")}
          </button>
        </div>

        <div className="relative min-h-0 flex-1 border-t border-border">
          {!activePath && (
            <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 px-6 text-center font-mono text-[13px] text-muted">
              {t("chooseFile")}
            </div>
          )}
          {activePath && <CodeEditor path={activePath} value={code} onChange={onChange} onSave={onSave} />}
        </div>
      </section>

      {dialog && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/65 px-4 backdrop-blur-[2px]">
          <form
            onSubmit={submitDialog}
            className="w-full max-w-[420px] rounded-xl border border-border bg-panel"
          >
            <div className="flex h-11 items-center justify-between border-b border-border px-4">
              <div className="text-[13px] font-semibold text-fg">{fileDialogTitle(dialog)}</div>
              <button
                type="button"
                className={iconBtn}
                onClick={() => setDialog(null)}
                title={common("close")}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
            <div className="px-4 py-4">
              {dialog.kind === "delete" ? (
                <div className="rounded-md border border-red/30 bg-red/10 px-3 py-2.5 font-mono text-[12.5px] text-[#ffd0cc]">
                  {dialog.path}
                </div>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] text-muted">{t("filePath")}</span>
                  <input
                    autoFocus
                    className="h-9 w-full rounded-md border border-border bg-codebg px-3 font-mono text-[13px] text-fg outline-none transition focus:border-accent"
                    value={dialog.path}
                    onChange={(event) => setDialog({ ...dialog, path: event.target.value, error: "" })}
                  />
                </label>
              )}
              {dialog.error && (
                <div className="mt-3 rounded-md border border-red/30 bg-red/10 px-3 py-2 text-[12px] text-[#ffd0cc]">
                  {dialog.error}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                className="h-8 rounded-md border border-border px-3 text-[12px] text-muted transition hover:border-accent hover:text-accent"
                onClick={() => setDialog(null)}
              >
                {common("cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting || activeFileSyncing}
                className={
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-semibold transition disabled:opacity-50 " +
                  (dialog.kind === "delete"
                    ? "border-red bg-red text-white hover:bg-[#ff6b64]"
                    : "border-accent bg-accent text-white hover:bg-[#d04200]")
                }
              >
                {submitting && <Spinner />}
                {fileDialogAction(dialog)}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
