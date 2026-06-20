/**
 * [INPUT]: AI/用户写的 JSX/TS 源码字符串
 * [OUTPUT]: 浏览器能直接 import 的 JS 字符串（import 语句原样保留，交给沙箱 importmap 解析）
 * [POS]: B 域转译层 —— 夹在"出码"和"沙箱执行"之间，纯文本变换、不执行
 * [PROTOCOL]: 换转译器先改这里 + docs/frontend-transpile.md，再看 CLAUDE.md
 *
 * 用 esbuild-wasm 替代 Babel：一次性 initialize 加载 wasm，之后每次 transform 极快。
 * 只用 transform（转语法），不用 bundle（依赖靠沙箱 importmap + esm.sh）。
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

/** 源码 → JS。失败（语法错）抛 TranspileError，对应 agent loop 的 COMPILE_ERROR。 */
export async function transpile(code: string): Promise<string> {
  await ensureInit();
  try {
    const result = await esbuild.transform(code, {
      loader: "tsx", // 同时吃 JSX + TS
      jsx: "automatic", // React 17+ 自动 runtime，源码不必手动 import React
      target: "es2020",
      format: "esm",
    });
    return result.code;
  } catch (e: any) {
    const failures: TranspileFailure[] = (e?.errors ?? []).map((er: any) => ({
      text: er.text ?? String(er),
      location: er.location
        ? { line: er.location.line, column: er.location.column }
        : null,
    }));
    throw new TranspileError(
      failures.length ? failures : [{ text: String(e?.message ?? e), location: null }]
    );
  }
}

/** 预热：app 启动时调用，提前把 wasm 拉好，避免首次生成时等待。 */
export function warmup(): Promise<void> {
  return ensureInit();
}
