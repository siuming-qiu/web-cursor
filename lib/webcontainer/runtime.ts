"use client";

import { WebContainer, type WebContainerProcess } from "@webcontainer/api";
import { assertWebContainerProjectContract } from "@/lib/webcontainer/contract";
import { projectFilesToFileSystemTree } from "@/lib/webcontainer/files";
import {
  WEB_CONTAINER_RUN_EVENT,
  WebContainerDevServerError,
  WebContainerInstallError,
  WebContainerUserError,
  type WebContainerProjectFile,
  type WebContainerRunEvent,
} from "@/lib/webcontainer/types";

export const WEB_CONTAINER_DEV_SERVER_PORT = 5173;
export const WEB_CONTAINER_DEV_COMMAND = `npm run dev -- --host 0.0.0.0 --port ${WEB_CONTAINER_DEV_SERVER_PORT}`;

const SERVER_READY_TIMEOUT_MS = 30000;

type RunWebContainerProjectOptions = {
  files: WebContainerProjectFile[];
  onEvent: (event: WebContainerRunEvent) => void;
};

export type RunWebContainerProjectResult = {
  port: number;
  url: string;
  rawLog: string;
};

type WebContainerRuntimeState = {
  instancePromise: Promise<WebContainer> | null;
  devProcess: WebContainerProcess | null;
};

type WebContainerGlobal = typeof globalThis & {
  __webCursorWebContainerRuntime?: WebContainerRuntimeState;
};

function runtimeState() {
  const globalState = globalThis as WebContainerGlobal;
  if (!globalState.__webCursorWebContainerRuntime) {
    globalState.__webCursorWebContainerRuntime = {
      instancePromise: null,
      devProcess: null,
    };
  }
  return globalState.__webCursorWebContainerRuntime;
}

function cleanProcessOutput(text: string) {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n");
}

async function bootWebContainer(onEvent: (event: WebContainerRunEvent) => void) {
  const state = runtimeState();
  if (!state.instancePromise) {
    onEvent({ type: WEB_CONTAINER_RUN_EVENT.BootStart });
    state.instancePromise = WebContainer.boot().catch((error) => {
      state.instancePromise = null;
      throw error;
    });
  }
  const webcontainer = await state.instancePromise;
  onEvent({ type: WEB_CONTAINER_RUN_EVENT.BootReady });
  return webcontainer;
}

function createLogPipe(onText: (text: string) => void) {
  return new WritableStream<string>({
    write(text) {
      onText(text);
    },
  });
}

async function stopProcess(process: WebContainerProcess | null) {
  if (!process) return;
  try {
    process.kill();
  } catch {
    // kill is best-effort; a finished process may already be gone.
  }
}

function waitForServerReady(webcontainer: WebContainer, log: () => string) {
  return new Promise<{ port: number; url: string }>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const cleanup = () => {
      window.clearTimeout(timer);
      unsubscribe?.();
      unsubscribe = null;
    };
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new WebContainerDevServerError("等待 WebContainer dev server 启动超时", null, log()));
    }, SERVER_READY_TIMEOUT_MS);

    unsubscribe = webcontainer.on("server-ready", (port, url) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ port, url });
    });
  });
}

export async function stopWebContainerProject() {
  const state = runtimeState();
  await stopProcess(state.devProcess);
  state.devProcess = null;
}

export async function runWebContainerProject({
  files,
  onEvent,
}: RunWebContainerProjectOptions): Promise<RunWebContainerProjectResult> {
  assertWebContainerProjectContract(files);
  const tree = projectFilesToFileSystemTree(files);
  const webcontainer = await bootWebContainer(onEvent);

  await stopWebContainerProject();

  onEvent({ type: WEB_CONTAINER_RUN_EVENT.MountStart });
  await webcontainer.mount(tree);
  onEvent({ type: WEB_CONTAINER_RUN_EVENT.MountReady });

  let installLog = "";
  onEvent({ type: WEB_CONTAINER_RUN_EVENT.InstallStart });
  const install = await webcontainer.spawn("npm", ["install"]);
  void install.output.pipeTo(createLogPipe((text) => {
    const cleanText = cleanProcessOutput(text);
    installLog += cleanText;
    if (cleanText) onEvent({ type: WEB_CONTAINER_RUN_EVENT.InstallLog, text: cleanText });
  }));
  const installExit = await install.exit;
  if (installExit !== 0) {
    onEvent({ type: WEB_CONTAINER_RUN_EVENT.InstallError, exitCode: installExit, rawLog: installLog });
    throw new WebContainerInstallError(installExit, installLog);
  }

  let devLog = "";
  onEvent({ type: WEB_CONTAINER_RUN_EVENT.DevServerStart });
  const state = runtimeState();
  state.devProcess = await webcontainer.spawn("npm", [
    "run",
    "dev",
    "--",
    "--host",
    "0.0.0.0",
    "--port",
    String(WEB_CONTAINER_DEV_SERVER_PORT),
  ]);
  void state.devProcess.output.pipeTo(createLogPipe((text) => {
    const cleanText = cleanProcessOutput(text);
    devLog += cleanText;
    if (cleanText) onEvent({ type: WEB_CONTAINER_RUN_EVENT.DevServerLog, text: cleanText });
  }));

  const exitPromise = state.devProcess.exit.then((exitCode) => {
    throw new WebContainerDevServerError(`npm run dev exited with code ${exitCode}`, exitCode, devLog);
  });
  const ready = await Promise.race([waitForServerReady(webcontainer, () => devLog), exitPromise]);
  onEvent({ type: WEB_CONTAINER_RUN_EVENT.ServerReady, port: ready.port, url: ready.url });
  return { ...ready, rawLog: devLog };
}

export function toWebContainerUserMessage(error: unknown) {
  if (error instanceof WebContainerUserError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
