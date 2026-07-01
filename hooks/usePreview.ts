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
  WEB_CONTAINER_RUN_EVENT,
  WebContainerDevServerError,
  WebContainerInstallError,
  type WebContainerProjectFile,
  type WebContainerRunEvent,
} from "@/lib/webcontainer/types";
import type { Overlay, Status } from "@/lib/types";
import { ToolResultType, type ToolResult } from "@/types/tool";

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

function isBrowserRuntimeError(data: unknown): data is { type: typeof ToolResultType.BrowserRuntimeError; message: string; stack?: string } {
  return Boolean(
    data
      && typeof data === "object"
      && (data as { type?: unknown }).type === ToolResultType.BrowserRuntimeError
      && typeof (data as { message?: unknown }).message === "string"
  );
}

export function usePreview(readProjectFiles: (projectId: string) => Promise<WebContainerProjectFile[]>) {
  const t = useTranslations("Preview");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runIdRef = useRef(0);
  const rawDevLogRef = useRef("");

  const [status, setStatus] = useState<Status>({ kind: "", text: t("waitingGeneration") });
  const [overlay, setOverlay] = useState<Overlay>(EMPTY_OVERLAY);
  const [hasResult, setHasResult] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [previewRunPhase, setPreviewRunPhase] = useState<PreviewRunPhase>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [runLogs, setRunLogs] = useState<string[]>([]);

  useEffect(() => {
    return () => {
      void stopWebContainerProject();
    };
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (iframeRef.current?.contentWindow && event.source !== iframeRef.current.contentWindow) return;
      if (!isBrowserRuntimeError(event.data)) return;
      setStatus({ kind: "err", text: t("browserRuntimeError") });
      setOverlay({
        show: true,
        title: "Browser Runtime Error",
        message: event.data.message,
        stack: event.data.stack ?? "",
        showStack: false,
      });
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [t]);

  const resetPreview = useCallback((text: string) => {
    runIdRef.current += 1;
    setHasResult(false);
    setPreviewActive(false);
    setPreviewUrl(null);
    setRunLogs([]);
    rawDevLogRef.current = "";
    setOverlay(EMPTY_OVERLAY);
    setStatus({ kind: "", text });
    setPreviewRunPhase("idle");
  }, []);

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
        setStatus({ kind: "ok", text: t("serverReady"), meta: `:${event.port}` });
        setPreviewUrl(event.url);
        break;
      case WEB_CONTAINER_RUN_EVENT.InstallError:
      case WEB_CONTAINER_RUN_EVENT.DevServerError:
        break;
    }
  }, [appendLog, t]);

  const runPreview = useCallback(
    async (projectId: string): Promise<ToolResult | null> => {
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
        if (!isCurrentRun()) return null;
        if (error instanceof WebContainerInstallError) {
          setStatus({ kind: "err", text: t("installFailed") });
          setOverlay({ show: true, title: "npm install", message: error.rawLog || error.message, stack: "", showStack: false });
          setPreviewRunPhase("idle");
          return {
            status: "error",
            type: ToolResultType.InstallError,
            command: "npm install",
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
    [handleRunEvent, readProjectFiles, t]
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
