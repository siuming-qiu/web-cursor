"use client";

import { WebContainerUserError, type WebContainerProjectFile } from "@/lib/webcontainer/types";

type PackageJson = {
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
};

function parsePackageJson(content: string): PackageJson {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new WebContainerUserError("package.json 不是合法 JSON 对象");
    }
    return parsed as PackageJson;
  } catch (error) {
    if (error instanceof WebContainerUserError) throw error;
    throw new WebContainerUserError("package.json 不是合法 JSON");
  }
}

function assertRecord(value: unknown, label: string) {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new WebContainerUserError(`package.json ${label} 必须是对象`);
  }
}

export function assertWebContainerProjectContract(files: WebContainerProjectFile[]) {
  const packageJson = files.find((file) => file.path === "package.json")?.content;
  if (!packageJson) {
    throw new WebContainerUserError("缺少 package.json，WebContainer 无法安装依赖和启动 dev server");
  }

  const parsed = parsePackageJson(packageJson);
  if (!parsed.scripts || typeof parsed.scripts !== "object" || Array.isArray(parsed.scripts)) {
    throw new WebContainerUserError("package.json 缺少 scripts 对象");
  }

  const scripts = parsed.scripts as Record<string, unknown>;
  if (typeof scripts.dev !== "string" || !scripts.dev.trim()) {
    throw new WebContainerUserError("package.json 缺少 scripts.dev，WebContainer 无法启动 dev server");
  }

  assertRecord(parsed.dependencies, "dependencies");
  assertRecord(parsed.devDependencies, "devDependencies");
}
