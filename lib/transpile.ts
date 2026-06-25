/**
 * [INPUT]: 项目文件列表
 * [OUTPUT]: 浏览器可执行的项目编译产物：entryPath + JS bundle + CSS bundle
 * [POS]: B 域转译层 —— 夹在"出码"和"沙箱执行"之间，纯文本变换、不执行
 * [PROTOCOL]: 换转译器先改这里 + docs/frontend-transpile.md，再看 CLAUDE.md
 *
 * 按正常 Vite React 项目处理：从 index.html 的 module script 读取入口，解析本地 import，收集 CSS。
 */
"use client";

import * as esbuild from "esbuild-wasm";

let initPromise: Promise<void> | null = null;

// 初始化只做一次：多次调用复用同一个 Promise（esbuild 重复 initialize 会抛错）
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = esbuild.initialize({ wasmURL: "/esbuild.wasm" });
  }
  return initPromise;
}

export interface TranspileFailure {
  text: string;
  location: { line: number; column: number } | null;
}

export class TranspileError extends Error {
  failures: TranspileFailure[];
  constructor(failures: TranspileFailure[]) {
    super(failures[0]?.text || "转译失败");
    this.name = "TranspileError";
    this.failures = failures;
  }
}

export type TranspileProjectFile = {
  path: string;
  content: string;
};

export type CompiledProject = {
  entryPath: string;
  js: string;
  css: string;
};

const DEFAULT_DEPENDENCIES: Record<string, string> = {
  react: "18.3.1",
  "react-dom": "18.3.1",
};

const SCRIPT_EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
const STYLE_EXTENSIONS = ["", ".css"];

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function dirname(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function loaderFor(path: string): esbuild.Loader {
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".js")) return "js";
  return "tsx";
}

function resolveLocalPath(files: Map<string, string>, importer: string, specifier: string): string | null {
  const base = specifier.startsWith(".")
    ? normalizePath(`${dirname(importer)}/${specifier}`)
    : normalizePath(specifier);

  const suffixes = specifier.endsWith(".css") ? STYLE_EXTENSIONS : [...SCRIPT_EXTENSIONS, ...STYLE_EXTENSIONS];
  for (const suffix of suffixes) {
    const candidate = normalizePath(`${base}${suffix}`);
    if (files.has(candidate)) return candidate;
  }
  return null;
}

function parsePackageDependencies(content: string | undefined): Record<string, string> {
  if (!content) return DEFAULT_DEPENDENCIES;
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      ...DEFAULT_DEPENDENCIES,
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
  } catch {
    throw new TranspileError([{ text: "package.json 不是合法 JSON", location: null }]);
  }
}

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] ?? specifier;
}

function cleanVersion(version: string | undefined): string {
  if (!version) return "";
  return version.trim().replace(/^[~^]/, "");
}

function esmUrl(specifier: string, deps: Record<string, string>): string | null {
  const name = packageName(specifier);
  const version = cleanVersion(deps[name]);
  if (!version) return null;
  return `https://esm.sh/${name}@${version}${specifier.slice(name.length)}`;
}

function entryFromHtml(html: string): string | null {
  const match = html.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i)
    ?? html.match(/<script\b[^>]*src=["']([^"']+)["'][^>]*type=["']module["'][^>]*>/i);
  if (!match?.[1]) return null;
  return normalizePath(match[1].replace(/^\//, ""));
}

function detectEntry(fileMap: Map<string, string>): string {
  const htmlEntry = fileMap.get("index.html");
  if (!htmlEntry) {
    throw new TranspileError([{ text: "找不到 index.html：React 项目必须通过 index.html 声明入口文件", location: null }]);
  }

  const entry = entryFromHtml(htmlEntry);
  if (!entry) {
    throw new TranspileError([{ text: "index.html 缺少 <script type=\"module\" src=\"...\"> 入口声明", location: null }]);
  }
  if (!fileMap.has(entry)) {
    throw new TranspileError([{ text: `index.html 指向的入口文件不存在：${entry}`, location: null }]);
  }
  return entry;
}

function toTranspileError(error: any): TranspileError {
  const failures: TranspileFailure[] = (error?.errors ?? []).map((er: any) => ({
    text: er.text ?? String(er),
    location: er.location
      ? { line: er.location.line, column: er.location.column }
      : null,
  }));
  return new TranspileError(
    failures.length ? failures : [{ text: String(error?.message ?? error), location: null }]
  );
}

/** 源码 → JS。失败（语法错）抛 TranspileError，对应 agent loop 的 COMPILE_ERROR。 */
export async function transpile(code: string): Promise<string> {
  await ensureInit();
  try {
    const result = await esbuild.transform(code, {
      loader: "tsx", // 同时吃 JSX + TS
      jsx: "automatic", // React 17+ 自动 runtime，源码不必手动 import React
      target: "es2020",
      format: "esm",
      logLevel: "silent",
    });
    return result.code;
  } catch (e: any) {
    throw toTranspileError(e);
  }
}

export async function compileProject(files: TranspileProjectFile[]): Promise<CompiledProject> {
  await ensureInit();

  const fileMap = new Map(files.map((file) => [normalizePath(file.path), file.content]));
  const entry = detectEntry(fileMap);
  const dependencies = parsePackageDependencies(fileMap.get("package.json"));
  if (!fileMap.has(entry)) {
    throw new TranspileError([{ text: `入口文件不存在：${entry}`, location: null }]);
  }

  try {
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      outdir: "out",
      format: "esm",
      target: "es2020",
      jsx: "automatic",
      logLevel: "silent",
      plugins: [
        {
          name: "project-files",
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              const importer = args.importer ? normalizePath(args.importer) : entry;
              const path = resolveLocalPath(fileMap, importer, args.path);
              if (path) return { path, namespace: "project" };

              if (args.path.startsWith(".")) {
                return {
                  errors: [{ text: `本地依赖不存在：${args.path}（from ${importer}）` }],
                };
              }

              if (args.kind === "entry-point") {
                return { errors: [{ text: `入口文件不存在：${args.path}` }] };
              }

              if (args.path.endsWith(".css")) {
                return { errors: [{ text: `暂不支持从 npm 包导入 CSS：${args.path}` }] };
              }

              const url = esmUrl(args.path, dependencies);
              if (!url) {
                return { errors: [{ text: `依赖未在 package.json 声明：${packageName(args.path)}` }] };
              }
              return { path: url, external: true };
            });

            build.onLoad({ filter: /.*/, namespace: "project" }, (args) => {
              const contents = fileMap.get(normalizePath(args.path));
              if (contents === undefined) {
                return { errors: [{ text: `文件不存在：${args.path}` }] };
              }
              return { contents, loader: loaderFor(args.path) };
            });
          },
        },
      ],
    });

    return {
      entryPath: entry,
      js: result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "",
      css: result.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text).join("\n"),
    };
  } catch (e: any) {
    throw toTranspileError(e);
  }
}

/** 预热：app 启动时调用，提前把 wasm 拉好，避免首次生成时等待。 */
export function warmup(): Promise<void> {
  return ensureInit();
}
