/**
 * [INPUT]: 项目文件读取函数 + iframe
 * [OUTPUT]: 预览状态、错误浮层、runPreview
 * [POS]: B 域预览执行 hook —— 编译项目并交给 iframe 沙箱运行
 * [PROTOCOL]: 这里只处理 compile/run，不处理 chat/messages，也不保存文件。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatProjectContractErrors,
  validateReactProjectContract,
} from "@/lib/projectContract";
import { preloadImportMap } from "@/lib/modulePreload";
import { SandboxController } from "@/lib/sandbox/controller";
import { compileProject, TranspileError, type TranspileProjectFile } from "@/lib/transpile";
import type { Overlay, Status } from "@/lib/types";
import { ToolResultType, type ToolResult } from "@/types/tool";

const EMPTY_OVERLAY: Overlay = { show: false, message: "", stack: "", showStack: false };

export type PreviewRunPhase = "idle" | "reading" | "compiling" | "running";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function interruptedPreviewResult(message: string): ToolResult {
  return { status: "error", type: ToolResultType.ToolInterrupted, message };
}

export function usePreview(readProjectFiles: (projectId: string) => Promise<TranspileProjectFile[]>) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sandboxRef = useRef<SandboxController | null>(null);
  const runIdRef = useRef(0);

  const [status, setStatus] = useState<Status>({ kind: "", text: "等待生成" });
  const [overlay, setOverlay] = useState<Overlay>(EMPTY_OVERLAY);
  const [hasResult, setHasResult] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [previewRunPhase, setPreviewRunPhase] = useState<PreviewRunPhase>("idle");

  const ensureSandbox = useCallback(() => {
    if (iframeRef.current && !sandboxRef.current) {
      const ctl = new SandboxController(iframeRef.current);
      ctl.onLateError = (e) =>
        setOverlay({ show: true, message: e.message, stack: e.stack, showStack: false });
      sandboxRef.current = ctl;
    }
    return sandboxRef.current;
  }, []);

  const waitForSandbox = useCallback(async () => {
    for (let i = 0; i < 8; i++) {
      const sandbox = ensureSandbox();
      if (sandbox) return sandbox;
      await nextFrame();
    }
    return null;
  }, [ensureSandbox]);

  useEffect(() => {
    ensureSandbox();
  });

  useEffect(() => {
    return () => sandboxRef.current?.dispose();
  }, []);

  const resetPreview = useCallback((text: string) => {
    runIdRef.current += 1;
    setHasResult(false);
    setPreviewActive(false);
    setOverlay(EMPTY_OVERLAY);
    setStatus({ kind: "", text });
    setPreviewRunPhase("idle");
  }, []);

  const runPreview = useCallback(
    async (projectId: string): Promise<ToolResult | null> => {
      const runId = ++runIdRef.current;
      const isCurrentRun = () => runId === runIdRef.current;
      let projectFiles: TranspileProjectFile[];
      setPreviewRunPhase("reading");
      setOverlay((current) => ({ ...current, show: false }));
      try {
        projectFiles = await readProjectFiles(projectId);
      } catch {
        if (!isCurrentRun()) return null;
        setStatus({ kind: "err", text: "读取预览文件失败" });
        setPreviewActive(false);
        setPreviewRunPhase("idle");
        return { status: "error", type: ToolResultType.CompileError, message: "读取预览文件失败" };
      }

      const contract = validateReactProjectContract(projectFiles);
      if (!contract.ok) {
        if (!isCurrentRun()) return null;
        const message = formatProjectContractErrors(contract.errors);
        resetPreview("生成完整 React 项目后可预览");
        return { status: "error", type: ToolResultType.CompileError, message };
      }

      if (!isCurrentRun()) return null;
      setPreviewActive(true);
      setPreviewRunPhase("compiling");
      setStatus({ kind: "load", text: "编译项目中…（esbuild-wasm）" });
      try {
        const compiled = await compileProject(projectFiles);
        if (!isCurrentRun()) return null;
        preloadImportMap(compiled.importMap);
        setPreviewRunPhase("running");
        setStatus({ kind: "load", text: "执行中…" });
        const sandbox = await waitForSandbox();
        if (!isCurrentRun()) return null;
        if (!sandbox) {
          setStatus({ kind: "", text: `${compiled.entryPath} 已编译，等待预览挂载` });
          setPreviewRunPhase("idle");
          return interruptedPreviewResult("浏览器沙箱尚未挂载，无法运行预览。");
        }

        const t0 = performance.now();
        const result = await sandbox.run(compiled);
        if (!isCurrentRun()) return null;
        const dur = Math.round(performance.now() - t0);

        if (result?.type === ToolResultType.RenderOk) {
          setStatus({ kind: "ok", text: "渲染成功", meta: `· ${dur}ms` });
          setOverlay((o) => ({ ...o, show: false }));
          setHasResult(true);
          setPreviewRunPhase("idle");
          return { status: "ok", type: ToolResultType.RenderOk, durationMs: dur };
        }

        if (result) {
          setStatus({ kind: "err", text: "运行报错" });
          setOverlay({ show: true, message: result.message, stack: result.stack, showStack: false });
          setPreviewRunPhase("idle");
          return {
            status: "error",
            type: ToolResultType.RuntimeError,
            message: result.message,
            stack: result.stack,
          };
        }

        setStatus({ kind: "", text: `${compiled.entryPath} 已加载` });
        setPreviewRunPhase("idle");
        return interruptedPreviewResult("预览没有返回明确的运行结果。");
      } catch (error) {
        if (!isCurrentRun()) return null;
        const message = error instanceof TranspileError
          ? error.failures.map((failure) => failure.text).join("; ")
          : String(error instanceof Error ? error.message : error);
        setStatus({ kind: "err", text: "编译报错" });
        setOverlay({ show: true, message: "编译错误：" + message, stack: "", showStack: false });
        setPreviewRunPhase("idle");
        return { status: "error", type: ToolResultType.CompileError, message };
      }
    },
    [readProjectFiles, resetPreview, waitForSandbox]
  );

  return {
    iframeRef,
    status,
    setStatus,
    overlay,
    setOverlay,
    hasResult,
    previewActive,
    previewRunPhase,
    resetPreview,
    runPreview,
  };
}
