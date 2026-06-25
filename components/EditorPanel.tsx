"use client";

import dynamic from "next/dynamic";
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
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#303848] bg-[#1c2430] text-[13px] text-muted transition hover:border-accent hover:text-accent disabled:opacity-40";

export default function EditorPanel({
  code,
  files,
  activePath,
  dirty,
  writing,
  saving,
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
  dirty: boolean;
  writing: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onOpenFile: (path: string) => void;
  onSave: () => void;
  onNewFile: () => void;
  onRenameFile: () => void;
  onDeleteFile: () => void;
}) {
  const groups = groupFiles(files);
  const canEdit = !!activePath;

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-xl border border-[#2a3142] bg-[#0b0e14] shadow-[0_18px_42px_rgba(0,0,0,0.22)]">
      <aside className="flex h-full w-[270px] flex-none flex-col border-r border-[#2a3142] bg-[#111821]">
        <div className="h-11 flex-none flex items-center justify-between gap-2 border-b border-[#2a3142] bg-[#141b25] px-3.5 text-[12px] uppercase tracking-[0.08em] text-muted">
          <span>Files</span>
          <span className="ml-auto rounded bg-[#0b0e14] px-2 py-0.5 text-[11px] tracking-normal text-[#6f7b8f]">{files.length}</span>
          <button className={iconBtn} onClick={onNewFile} title="新建文件">
            ＋
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
          {groups.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] leading-5 text-muted">
              还没有文件。AI 写入或手动新建后会显示在这里。
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <div key={group.dir || "__root"}>
                  {group.dir && (
                    <div className="mb-1.5 flex items-center gap-1.5 px-1.5 text-[11px] uppercase tracking-[0.06em] text-[#758195]">
                      <span className="text-[#5f6d82]">▾</span>
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
                              ? "border-[#4584d7] bg-[#172b44] text-fg shadow-[inset_3px_0_0_#58a6ff]"
                              : "border-transparent text-muted hover:bg-[#1a2431] hover:text-fg")
                          }
                          onClick={() => onOpenFile(file.path)}
                          title={file.path}
                        >
                          <span className={active ? "text-accent" : "text-[#788292]"}>□</span>
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

      <section className="flex h-full min-w-0 flex-1 flex-col bg-[#1e1e1e]">
        <div className="h-11 flex-none flex items-center gap-2 border-b border-[#2a3142] bg-[#11161f] px-3 text-[12px] text-muted">
          <div className="flex h-full min-w-0 max-w-[520px] items-center gap-2 border-t-2 border-accent bg-[#1e1e1e] px-3">
            <span className="text-accent">□</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-[#d7dde8]">{activePath ?? "未选择文件"}</span>
          </div>
          <div className="flex-1" />
          {dirty && <span className="rounded bg-yellow/10 px-1.5 py-0.5 text-[11px] text-yellow">未保存</span>}
          {writing && (
            <span className="inline-flex items-center gap-1.5 rounded bg-codebg/80 px-2 py-[3px] text-[11px] text-accent">
              <Spinner /> AI 写入
            </span>
          )}
          {saving && (
            <span className="inline-flex items-center gap-1.5 rounded bg-codebg/80 px-2 py-[3px] text-[11px] text-accent">
              <Spinner /> 保存中
            </span>
          )}
          <button className={iconBtn} disabled={!canEdit || saving} onClick={onRenameFile} title="重命名或移动">
            ↪
          </button>
          <button className={iconBtn} disabled={!canEdit || saving} onClick={onDeleteFile} title="删除文件">
            ×
          </button>
          <button
            className="inline-flex h-7 items-center rounded-md border border-accent bg-accent px-2.5 text-[12px] font-semibold text-[#04101f] transition hover:bg-[#79b8ff] disabled:opacity-40"
            disabled={!canEdit || !dirty || saving}
            onClick={onSave}
          >
            保存
          </button>
        </div>

        <div className="relative min-h-0 flex-1 border-t border-[#151923]">
          {!activePath && (
            <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 px-6 text-center font-mono text-[13px] text-[#3a4150]">
              // 选择或新建一个文件
            </div>
          )}
          {activePath && <CodeEditor path={activePath} value={code} onChange={onChange} />}
        </div>
      </section>
    </div>
  );
}
