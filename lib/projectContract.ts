"use client";

export type ProjectContractFile = {
  path: string;
  content: string;
};

export const ReactProjectFile = {
  PackageJson: "package.json",
  IndexHtml: "index.html",
  Main: "src/main.tsx",
  App: "src/App.tsx",
} as const;

export const REQUIRED_REACT_PROJECT_FILES = [
  ReactProjectFile.PackageJson,
  ReactProjectFile.IndexHtml,
  ReactProjectFile.Main,
  ReactProjectFile.App,
] as const;

export type ProjectContractResult =
  | { ok: true }
  | { ok: false; errors: string[] };

function fileMap(files: ProjectContractFile[]) {
  return new Map(files.map((file) => [file.path, file.content]));
}

function parsePackageJson(content: string): { dependencies?: unknown; webCursor?: unknown } | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as { dependencies?: unknown; webCursor?: unknown }
      : null;
  } catch {
    return null;
  }
}

function htmlEntry(html: string): string | null {
  const match = html.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i)
    ?? html.match(/<script\b[^>]*src=["']([^"']+)["'][^>]*type=["']module["'][^>]*>/i);
  return match?.[1]?.replace(/^\//, "") ?? null;
}

export function validateReactProjectContract(files: ProjectContractFile[]): ProjectContractResult {
  const map = fileMap(files);
  const errors: string[] = [];

  for (const path of REQUIRED_REACT_PROJECT_FILES) {
    if (!map.has(path)) errors.push(`缺少必需文件：${path}`);
  }

  const packageJson = map.get(ReactProjectFile.PackageJson);
  if (packageJson) {
    const parsed = parsePackageJson(packageJson);
    if (!parsed) {
      errors.push("package.json 不是合法 JSON 对象");
    } else if (!parsed.dependencies || typeof parsed.dependencies !== "object" || Array.isArray(parsed.dependencies)) {
      errors.push("package.json 必须声明 dependencies 对象，浏览器会用它解析 esm.sh CDN 依赖");
    } else {
      const dependencies = parsed.dependencies as Record<string, unknown>;
      for (const [name, version] of Object.entries(dependencies)) {
        if (typeof version !== "string") {
          errors.push(`package.json dependencies.${name} 必须是字符串版本号`);
        }
      }
      if (typeof dependencies.react !== "string") {
        errors.push("package.json dependencies 缺少 react；React 默认通过 esm.sh CDN 加载，但必须在 dependencies 声明版本");
      }
      if (typeof dependencies["react-dom"] !== "string") {
        errors.push("package.json dependencies 缺少 react-dom；React DOM 默认通过 esm.sh CDN 加载，但必须在 dependencies 声明版本");
      }
    }

    if (parsed?.webCursor !== undefined) {
      if (typeof parsed.webCursor !== "object" || parsed.webCursor === null || Array.isArray(parsed.webCursor)) {
        errors.push("package.json webCursor 必须是对象");
      } else {
        const config = parsed.webCursor as { esmExternal?: unknown };
        if (config.esmExternal !== undefined) {
          if (!Array.isArray(config.esmExternal)) {
            errors.push("package.json webCursor.esmExternal 必须是字符串数组");
          } else {
            for (const [index, name] of config.esmExternal.entries()) {
              if (typeof name !== "string" || !name.trim()) {
                errors.push(`package.json webCursor.esmExternal[${index}] 必须是非空字符串`);
              }
            }
          }
        }
      }
    }
  }

  const indexHtml = map.get(ReactProjectFile.IndexHtml);
  if (indexHtml) {
    if (!/\bid=["']root["']/.test(indexHtml)) {
      errors.push("index.html 缺少 <div id=\"root\"></div> 挂载点");
    }

    const entry = htmlEntry(indexHtml);
    if (!entry) {
      errors.push("index.html 缺少 <script type=\"module\" src=\"/src/main.tsx\"></script> 入口声明");
    } else if (entry !== ReactProjectFile.Main) {
      errors.push(`index.html 入口必须是 ${ReactProjectFile.Main}，当前是 ${entry}`);
    } else if (!map.has(entry)) {
      errors.push(`index.html 指向的入口文件不存在：${entry}`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

export function formatProjectContractErrors(errors: string[]) {
  return errors.join("; ");
}
