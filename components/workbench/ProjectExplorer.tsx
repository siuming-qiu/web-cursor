"use client";

import { FormEvent, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileCode2, Folder, FolderOpen, Plus, X } from "lucide-react";
import type { ProjectFileSummary } from "@/lib/projectTypes";

type FileTreeNode =
  | Readonly<{
      kind: "directory";
      name: string;
      path: string;
      children: FileTreeNode[];
    }>
  | Readonly<{
      kind: "file";
      name: string;
      path: string;
    }>;

type MutableDirectory = {
  name: string;
  path: string;
  directories: Map<string, MutableDirectory>;
  files: ProjectFileSummary[];
};

function createDirectory(name: string, path: string): MutableDirectory {
  return { name, path, directories: new Map(), files: [] };
}

function directoryChildren(directory: MutableDirectory): FileTreeNode[] {
  const directories: FileTreeNode[] = [...directory.directories.values()]
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((child) => ({
      kind: "directory",
      name: child.name,
      path: child.path,
      children: directoryChildren(child),
    }));
  const files: FileTreeNode[] = directory.files
    .toSorted((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({
      kind: "file",
      name: file.path.split("/").at(-1) ?? file.path,
      path: file.path,
    }));
  return [...directories, ...files];
}

function buildFileTree(files: ProjectFileSummary[]): FileTreeNode[] {
  const root = createDirectory("", "");
  for (const file of files) {
    const parts = file.path.split("/");
    const directoryParts = parts.slice(0, -1);
    let parent = root;
    for (const name of directoryParts) {
      const directoryPath = parent.path ? `${parent.path}/${name}` : name;
      let child = parent.directories.get(name);
      if (!child) {
        child = createDirectory(name, directoryPath);
        parent.directories.set(name, child);
      }
      parent = child;
    }
    parent.files.push(file);
  }
  return directoryChildren(root);
}

export default function ProjectExplorer({
  files,
  activePath,
  onOpenFile,
  onNewFile,
  onCollapse,
}: {
  files: ProjectFileSummary[];
  activePath?: string;
  onOpenFile(path: string): void;
  onNewFile(path: string): void | Promise<void>;
  onCollapse(): void;
}) {
  const [creating, setCreating] = useState(false);
  const [path, setPath] = useState("src/components/NewFile.tsx");
  const [error, setError] = useState("");
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildFileTree(files), [files]);

  function toggleDirectory(directoryPath: string) {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(directoryPath)) next.delete(directoryPath);
      else next.add(directoryPath);
      return next;
    });
  }

  function renderNodes(nodes: FileTreeNode[], depth = 0) {
    return nodes.map((node) => {
      if (node.kind === "directory") {
        const expanded = !collapsedPaths.has(node.path);
        return (
          <div key={node.path} role="treeitem" aria-expanded={expanded}>
            <button
              type="button"
              className="group flex h-7 w-full items-center gap-1.5 border-l-2 border-transparent pr-2 text-left text-[12px] text-muted transition hover:bg-panel2 hover:text-fg"
              style={{ paddingLeft: 10 + depth * 14 }}
              title={node.path}
              onClick={() => toggleDirectory(node.path)}
            >
              <ChevronRight
                size={13}
                className={"flex-none transition-transform duration-150 " + (expanded ? "rotate-90 text-fg" : "text-muted")}
              />
              {expanded ? (
                <FolderOpen size={14} className="flex-none text-accent/90" />
              ) : (
                <Folder size={14} className="flex-none text-muted group-hover:text-accent/90" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
            </button>
            {expanded && (
              <div role="group">
                {renderNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      }

      const active = node.path === activePath;
      return (
        <button
          key={node.path}
          type="button"
          role="treeitem"
          aria-selected={active}
          className={
            "flex h-7 w-full items-center gap-1.5 border-l-2 pr-2 text-left font-mono text-[12px] transition " +
            (active
              ? "border-accent bg-[#24211d] text-fg"
              : "border-transparent text-muted hover:bg-panel2 hover:text-fg")
          }
          style={{ paddingLeft: 29 + depth * 14 }}
          title={node.path}
          onClick={() => onOpenFile(node.path)}
        >
          <FileCode2 size={13} className={"flex-none " + (active ? "text-accent" : "text-muted")} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
      );
    });
  }

  async function createFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!path.trim()) return;
    setError("");
    try {
      await onNewFile(path.trim());
      setCreating(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-panel" aria-label="Explorer">
      <div className="flex h-9 flex-none items-center px-4 text-[11px] uppercase tracking-[0.08em] text-muted">
        <span>Explorer</span>
        <div className="ml-auto flex items-center">
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded hover:bg-panel2 hover:text-fg"
            aria-label="新建文件"
            title="新建文件"
            onClick={() => setCreating(true)}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded hover:bg-panel2 hover:text-fg"
            aria-label="收起左侧栏"
            title="收起左侧栏"
            onClick={onCollapse}
          >
            <ChevronLeft size={14} />
          </button>
        </div>
      </div>
      <div className="flex h-8 flex-none items-center gap-1.5 border-y border-border px-3 text-xs font-semibold text-fg">
        <FolderOpen size={14} className="text-accent" />
        <span>PROJECT</span>
        <span className="ml-auto rounded-full bg-panel2 px-1.5 py-0.5 font-mono text-[9px] font-normal text-muted">
          {files.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {creating && (
          <form className="border-b border-border px-2 pb-2" onSubmit={createFile}>
            <div className="flex gap-1">
              <input
                autoFocus
                value={path}
                onChange={(event) => setPath(event.target.value)}
                className="min-w-0 flex-1 rounded border border-accent bg-codebg px-2 py-1 font-mono text-[11px] text-fg outline-none"
              />
              <button type="button" className="grid w-6 place-items-center text-muted hover:text-fg" onClick={() => setCreating(false)}>
                <X size={13} />
              </button>
            </div>
            {error && <p className="mt-1 text-[10px] leading-4 text-[#ffd0cc]">{error}</p>}
          </form>
        )}
        {tree.length === 0 ? (
          <p className="px-4 py-3 text-xs leading-5 text-muted">项目中还没有文件。</p>
        ) : (
          <div role="tree" aria-label="项目文件">
            {renderNodes(tree)}
          </div>
        )}
      </div>
    </section>
  );
}
