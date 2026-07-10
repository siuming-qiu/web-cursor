/**
 * [INPUT]: WebContainer project files, run event callback, or global prewarm request
 * [OUTPUT]: dev server URL, install/dev server errors, preview runtime bridge injection, or warmed WebContainer singleton
 * [POS]: B 域 WebContainer runtime 单例 —— boot/mount/install/start 当前预览项目
 * [PROTOCOL]: 只在浏览器客户端调用；WebContainer 实例存在 globalThis，避免重复 boot；预热只 boot，不 mount/install/start。
 */
"use client";

import { WebContainer, type WebContainerProcess } from "@webcontainer/api";
import { assertWebContainerProjectContract } from "@/lib/webcontainer/contract";
import { projectFilesToFileSystemTree } from "@/lib/webcontainer/files";
import { withPreviewRuntimeBridge } from "@/lib/webcontainer/previewRuntimeBridge";
import {
  WEB_CONTAINER_RUN_EVENT,
  WebContainerBuildError,
  WebContainerDevServerError,
  WebContainerInstallError,
  WebContainerUserError,
  type WebContainerProjectFile,
  type WebContainerRunEvent,
} from "@/lib/webcontainer/types";
import { ToolCommand, ToolCommandPort } from "@/types/tool";

export const WEB_CONTAINER_DEV_SERVER_PORT = ToolCommandPort.DevServer;
export const WEB_CONTAINER_DEV_COMMAND = ToolCommand.DevServer;

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

export type BuildWebContainerStaticArtifactResult = {
  files: WebContainerBuildFile[];
  rawLog: string;
};

export type WebContainerBuildFile = {
  path: string;
  bytes: Uint8Array;
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

export async function prewarmWebContainer(onEvent: (event: WebContainerRunEvent) => void = () => undefined) {
  await bootWebContainer(onEvent);
}

function createLogPipe(onText: (text: string) => void) {
  return new WritableStream<string>({
    write(text) {
      onText(text);
    },
  });
}

function rewriteBrowserRouterForStaticArtifact(content: string) {
  return content.replace(
    /import\s*\{([^}]*\bBrowserRouter\b[^}]*)\}\s*from\s*["']react-router-dom["'];?/g,
    (statement, specifierText: string) => {
      const specifiers = specifierText.split(",").map((item) => item.trim()).filter(Boolean);
      const rewritten = specifiers.map((specifier) => (
        specifier === "BrowserRouter" ? "HashRouter as BrowserRouter" : specifier
      ));
      if (rewritten.join(", ") === specifiers.join(", ")) return statement;
      return `import { ${rewritten.join(", ")} } from "react-router-dom";`;
    }
  );
}

function filesForStaticArtifactBuild(files: WebContainerProjectFile[]) {
  return files.map((file) => {
    if (!/\.[jt]sx?$/.test(file.path)) return file;
    return {
      ...file,
      content: rewriteBrowserRouterForStaticArtifact(file.content),
    };
  });
}

async function collectDistFiles(webcontainer: WebContainer, dir = "dist"): Promise<WebContainerBuildFile[]> {
  const entries = await webcontainer.fs.readdir(dir, { withFileTypes: true }).catch(() => {
    throw new WebContainerBuildError("Missing build output: dist", null, "");
  });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return collectDistFiles(webcontainer, fullPath);
    const bytes = await webcontainer.fs.readFile(fullPath);
    return [{ path: fullPath.replace(/^dist\//, ""), bytes }];
  }));
  return files.flat().sort((a, b) => a.path.localeCompare(b.path));
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
  const tree = projectFilesToFileSystemTree(withPreviewRuntimeBridge(files));
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

export async function buildWebContainerStaticArtifact({
  files,
  onEvent,
}: RunWebContainerProjectOptions): Promise<BuildWebContainerStaticArtifactResult> {
  assertWebContainerProjectContract(files);
  const tree = projectFilesToFileSystemTree(filesForStaticArtifactBuild(files));
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

  let buildLog = "";
  onEvent({ type: WEB_CONTAINER_RUN_EVENT.BuildStart });
  const build = await webcontainer.spawn("npm", ["run", "build"]);
  void build.output.pipeTo(createLogPipe((text) => {
    const cleanText = cleanProcessOutput(text);
    buildLog += cleanText;
    if (cleanText) onEvent({ type: WEB_CONTAINER_RUN_EVENT.BuildLog, text: cleanText });
  }));
  const buildExit = await build.exit;
  if (buildExit !== 0) {
    onEvent({ type: WEB_CONTAINER_RUN_EVENT.BuildError, exitCode: buildExit, rawLog: buildLog });
    throw new WebContainerBuildError(`npm run build exited with code ${buildExit}`, buildExit, buildLog);
  }

  try {
    const files = await collectDistFiles(webcontainer);
    if (!files.some((file) => file.path === "index.html")) {
      throw new WebContainerBuildError("Missing build output: dist/index.html", null, buildLog);
    }
    onEvent({ type: WEB_CONTAINER_RUN_EVENT.BuildReady });
    return { files, rawLog: `${installLog}\n${buildLog}` };
  } catch (error) {
    if (error instanceof WebContainerBuildError) {
      throw new WebContainerBuildError(error.message, error.exitCode, `${installLog}\n${buildLog}\n${error.rawLog}`);
    }
    throw error;
  }
}

export function toWebContainerUserMessage(error: unknown) {
  if (error instanceof WebContainerUserError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
