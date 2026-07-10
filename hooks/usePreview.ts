/**
 * [INPUT]: 项目文件读取函数 + iframe
 * [OUTPUT]: WebContainer 预览状态、错误浮层、dev server URL、runPreview
 * [POS]: B 域预览执行 hook —— mount 项目到 WebContainer，运行 npm dev，并把 iframe 指向 dev server URL
 * [PROTOCOL]: 这里只处理 WebContainer run，不处理 chat/messages，也不保存文件。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  WEB_CONTAINER_DEV_COMMAND,
  runWebContainerProject,
  stopWebContainerProject,
  toWebContainerUserMessage,
} from "@/lib/webcontainer/runtime";
import {
  PREVIEW_RUNTIME_RESULT_TIMEOUT_MS,
  PreviewRuntimeMessageType,
  parsePreviewRuntimeMessage,
  withPreviewRunId,
  type PreviewRuntimeMessage,
} from "@/lib/webcontainer/previewRuntimeBridge";
import {
  WEB_CONTAINER_RUN_EVENT,
  WebContainerDevServerError,
  WebContainerInstallError,
  type WebContainerProjectFile,
  type WebContainerRunEvent,
} from "@/lib/webcontainer/types";
import type { Overlay, Status } from "@/lib/types";
import { ToolCommand, ToolResultType, type ToolResult } from "@/types/tool";

const EMPTY_OVERLAY: Overlay = { show: false, title: "Runtime Error", message: "", stack: "", showStack: false };

export type PreviewRunPhase =
  | "idle"
  | "reading"
  | "booting"
  | "mounting"
  | "installing"
  | "starting"
  | "server-ready";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function interruptedPreviewResult(message: string): ToolResult {
  return { status: "error", type: ToolResultType.ToolInterrupted, message };
}

type PendingPreviewRuntime = {
  runId: string;
  timeoutId: number;
  resolve: (message: PreviewRuntimeMessage | null) => void;
};

export function usePreview(readProjectFiles: (projectId: string) => Promise<WebContainerProjectFile[]>) {
  const t = useTranslations("Preview");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runIdRef = useRef(0);
  const rawDevLogRef = useRef("");
  const pendingRuntimeRef = useRef<PendingPreviewRuntime | null>(null);

  const [status, setStatus] = useState<Status>({ kind: "", text: t("waitingGeneration") });
  const [overlay, setOverlay] = useState<Overlay>(EMPTY_OVERLAY);
  const [hasResult, setHasResult] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [previewRunPhase, setPreviewRunPhase] = useState<PreviewRunPhase>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [runLogs, setRunLogs] = useState<string[]>([]);

  const settlePendingRuntime = useCallback((runId: string, message: PreviewRuntimeMessage | null) => {
    const pending = pendingRuntimeRef.current;
    if (!pending || pending.runId !== runId) return false;
    window.clearTimeout(pending.timeoutId);
    pendingRuntimeRef.current = null;
    pending.resolve(message);
    return true;
  }, []);

  const cancelPendingRuntime = useCallback(() => {
    const pending = pendingRuntimeRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    pendingRuntimeRef.current = null;
    pending.resolve(null);
  }, []);

  const waitForPreviewRuntime = useCallback((runId: string) => {
    cancelPendingRuntime();
    return new Promise<PreviewRuntimeMessage | null>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        settlePendingRuntime(runId, null);
      }, PREVIEW_RUNTIME_RESULT_TIMEOUT_MS);
      pendingRuntimeRef.current = { runId, timeoutId, resolve };
    });
  }, [cancelPendingRuntime, settlePendingRuntime]);

  useEffect(() => () => {
    cancelPendingRuntime();
    void stopWebContainerProject();
  }, [cancelPendingRuntime]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const previewWindow = iframeRef.current?.contentWindow;
      if (!previewWindow || event.source !== previewWindow) return;
      const message = parsePreviewRuntimeMessage(event.data);
      if (!message || message.runId !== String(runIdRef.current)) return;

      settlePendingRuntime(message.runId, message);
      if (message.type !== PreviewRuntimeMessageType.RuntimeError) return;
      setStatus({ kind: "err", text: t("browserRuntimeError") });
      setOverlay({
        show: true,
        title: "Browser Runtime Error",
        message: message.message,
        stack: message.stack ?? "",
        showStack: false,
      });
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [settlePendingRuntime, t]);

  const resetPreview = useCallback((text: string) => {
    cancelPendingRuntime();
    runIdRef.current += 1;
    setHasResult(false);
    setPreviewActive(false);
    setPreviewUrl(null);
    setRunLogs([]);
    rawDevLogRef.current = "";
    setOverlay(EMPTY_OVERLAY);
    setStatus({ kind: "", text });
    setPreviewRunPhase("idle");
  }, [cancelPendingRuntime]);

  const appendLog = useCallback((text: string) => {
    setRunLogs((logs) => [...logs, text].slice(-120));
  }, []);

  const handleRunEvent = useCallback((event: WebContainerRunEvent) => {
    switch (event.type) {
      case WEB_CONTAINER_RUN_EVENT.BootStart:
        setPreviewRunPhase("booting");
        setStatus({ kind: "load", text: t("bootingWebContainer") });
        break;
      case WEB_CONTAINER_RUN_EVENT.BootReady:
        setStatus({ kind: "load", text: t("webContainerReady") });
        break;
      case WEB_CONTAINER_RUN_EVENT.MountStart:
        setPreviewRunPhase("mounting");
        setStatus({ kind: "load", text: t("mountingProject") });
        break;
      case WEB_CONTAINER_RUN_EVENT.MountReady:
        setStatus({ kind: "load", text: t("projectMounted") });
        break;
      case WEB_CONTAINER_RUN_EVENT.InstallStart:
        setPreviewRunPhase("installing");
        setStatus({ kind: "load", text: t("installingDependencies") });
        break;
      case WEB_CONTAINER_RUN_EVENT.InstallLog:
        appendLog(event.text);
        break;
      case WEB_CONTAINER_RUN_EVENT.DevServerStart:
        rawDevLogRef.current = "";
        setPreviewRunPhase("starting");
        setStatus({ kind: "load", text: t("startingDevServer") });
        break;
      case WEB_CONTAINER_RUN_EVENT.DevServerLog:
        rawDevLogRef.current += event.text;
        appendLog(event.text);
        break;
      case WEB_CONTAINER_RUN_EVENT.ServerReady:
        setPreviewRunPhase("server-ready");
        setStatus({ kind: "load", text: t("validatingRuntime"), meta: `:${event.port}` });
        break;
      case WEB_CONTAINER_RUN_EVENT.InstallError:
      case WEB_CONTAINER_RUN_EVENT.DevServerError:
        break;
    }
  }, [appendLog, t]);

  const runPreview = useCallback(
    async (projectId: string): Promise<ToolResult | null> => {
      cancelPendingRuntime();
      const runId = ++runIdRef.current;
      const isCurrentRun = () => runId === runIdRef.current;
      let projectFiles: WebContainerProjectFile[];
      setPreviewRunPhase("reading");
      setRunLogs([]);
      setPreviewUrl(null);
      rawDevLogRef.current = "";
      setOverlay((current) => ({ ...current, show: false }));
      try {
        projectFiles = await readProjectFiles(projectId);
      } catch {
        if (!isCurrentRun()) return null;
        setStatus({ kind: "err", text: t("readFailed") });
        setPreviewActive(false);
        setPreviewRunPhase("idle");
        return {
          status: "error",
          type: ToolResultType.DevServerError,
          command: WEB_CONTAINER_DEV_COMMAND,
          exitCode: null,
          message: t("readFailed"),
          rawLog: t("readFailed"),
        };
      }

      if (!isCurrentRun()) return null;
      setPreviewActive(true);
      try {
        const t0 = performance.now();
        const result = await runWebContainerProject({
          files: projectFiles,
          onEvent: handleRunEvent,
        });
        if (!isCurrentRun()) return null;

        const runtimeMessagePromise = waitForPreviewRuntime(String(runId));
        setPreviewUrl(withPreviewRunId(result.url, runId));
        const runtimeMessage = await runtimeMessagePromise;
        if (!isCurrentRun()) return null;

        if (!runtimeMessage) {
          const message = t("runtimeFeedbackTimeout");
          setStatus({ kind: "err", text: message });
          setOverlay({ show: true, title: "Preview Runtime", message, stack: "", showStack: false });
          setPreviewRunPhase("idle");
          return interruptedPreviewResult(message);
        }

        if (runtimeMessage.type === PreviewRuntimeMessageType.RuntimeError) {
          setPreviewRunPhase("idle");
          return {
            status: "error",
            type: ToolResultType.BrowserRuntimeError,
            message: runtimeMessage.message,
            stack: runtimeMessage.stack,
            rawLog: result.rawLog,
          };
        }

        const dur = Math.round(performance.now() - t0);
        setStatus({ kind: "ok", text: t("serverReady"), meta: `:${result.port} · ${dur}ms` });
        setOverlay((o) => ({ ...o, show: false }));
        setHasResult(true);
        setPreviewRunPhase("idle");
        await nextFrame();
        return {
          status: "ok",
          type: ToolResultType.ServerReady,
          port: result.port,
          url: result.url,
          rawLog: result.rawLog,
          durationMs: dur,
        };
      } catch (error) {
        cancelPendingRuntime();
        if (!isCurrentRun()) return null;
        if (error instanceof WebContainerInstallError) {
          setStatus({ kind: "err", text: t("installFailed") });
          setOverlay({ show: true, title: ToolCommand.Install, message: error.rawLog || error.message, stack: "", showStack: false });
          setPreviewRunPhase("idle");
          return {
            status: "error",
            type: ToolResultType.InstallError,
            command: ToolCommand.Install,
            exitCode: error.exitCode,
            message: error.message,
            rawLog: error.rawLog,
          };
        }
        if (error instanceof WebContainerDevServerError) {
          setStatus({ kind: "err", text: t("devServerFailed") });
          setOverlay({ show: true, title: "npm run dev", message: error.rawLog || error.message, stack: "", showStack: false });
          setPreviewRunPhase("idle");
          return {
            status: "error",
            type: ToolResultType.DevServerError,
            command: WEB_CONTAINER_DEV_COMMAND,
            exitCode: error.exitCode,
            message: error.message,
            rawLog: error.rawLog,
          };
        }
        const message = toWebContainerUserMessage(error);
        setStatus({ kind: "err", text: t("devServerFailed") });
        setOverlay({ show: true, title: "WebContainer", message, stack: "", showStack: false });
        setPreviewRunPhase("idle");
        return {
          status: "error",
          type: ToolResultType.DevServerError,
          command: WEB_CONTAINER_DEV_COMMAND,
          exitCode: null,
          message,
          rawLog: message,
        };
      }
    },
    [cancelPendingRuntime, handleRunEvent, readProjectFiles, t, waitForPreviewRuntime]
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
    previewUrl,
    runLogs,
    resetPreview,
    runPreview,
  };
}
