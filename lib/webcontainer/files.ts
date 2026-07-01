"use client";

import type { FileSystemTree } from "@webcontainer/api";
import { WebContainerUserError, type WebContainerProjectFile } from "@/lib/webcontainer/types";

type DirectoryNode = Record<string, FileSystemTree[string]>;
type FileLikeNode = Extract<FileSystemTree[string], { file: unknown }>;

function isDirectoryNode(node: FileSystemTree[string] | undefined): node is { directory: FileSystemTree } {
  return Boolean(node && "directory" in node);
}

function isFileLikeNode(node: FileSystemTree[string] | undefined): node is FileLikeNode {
  return Boolean(node && "file" in node);
}

function normalizedPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new WebContainerUserError("非法文件路径：路径不能为空");
  }
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw new WebContainerUserError(`非法文件路径：${path}`);
  }

  const parts = trimmed.split("/");
  if (parts.some((part) => part === "..")) {
    throw new WebContainerUserError(`非法文件路径：${path}`);
  }
  const cleaned = parts.filter((part) => part && part !== ".");
  if (cleaned.length === 0) {
    throw new WebContainerUserError(`非法文件路径：${path}`);
  }
  return cleaned;
}

export function projectFilesToFileSystemTree(files: WebContainerProjectFile[]): FileSystemTree {
  const root: DirectoryNode = {};
  const seen = new Set<string>();

  for (const file of files) {
    const parts = normalizedPath(file.path);
    const normalized = parts.join("/");
    if (seen.has(normalized)) {
      throw new WebContainerUserError(`文件路径重复：${normalized}`);
    }
    seen.add(normalized);

    let current = root;
    for (const part of parts.slice(0, -1)) {
      const existing = current[part];
      if (isFileLikeNode(existing)) {
        throw new WebContainerUserError(`路径冲突：${part} 已作为文件存在，不能再作为目录`);
      }
      if (!existing) {
        current[part] = { directory: {} };
      }
      const next = current[part];
      if (!isDirectoryNode(next)) {
        throw new WebContainerUserError(`路径冲突：${part} 不是目录`);
      }
      current = next.directory as DirectoryNode;
    }

    const name = parts[parts.length - 1];
    if (!name) {
      throw new WebContainerUserError(`非法文件路径：${file.path}`);
    }
    const existing = current[name];
    if (isDirectoryNode(existing)) {
      throw new WebContainerUserError(`路径冲突：${normalized} 已作为目录存在，不能再作为文件`);
    }
    current[name] = { file: { contents: file.content } };
  }

  return root;
}
