/**
 * [INPUT]: iframe 元素 + 项目编译产物（run 调用）
 * [OUTPUT]: run() 返回 Promise<SandboxResult>；console 经回调透出
 * [POS]: B 域侧的沙箱桥 —— 把 iframe 的 postMessage 协议封装成 Promise，喂给 agent loop
 * [PROTOCOL]: 回传消息类型与 runner.ts 对齐
 */
"use client";

import type { CompiledProject } from "@/lib/transpile";
import { RUNNER_HTML } from "@/lib/sandbox/runner";

export type SandboxResult =
  | { type: "RENDER_OK" }
  | { type: "RUNTIME_ERROR"; message: string; stack: string };

export interface ConsoleEntry {
  level: "log" | "warn" | "error";
  text: string;
}

const RUN_TIMEOUT_MS = 30000; // 首次加载 esm.sh 依赖可能较慢；超时仍视为卡死/依赖加载失败（R3）

export class SandboxController {
  private iframe: HTMLIFrameElement;
  private ready = false;
  private runnerLoaded = false;
  private importMapKey: string | null = null;
  private nextRunId = 0;
  private lastSuccessfulRunId: number | null = null;
  private readyWaiters: (() => void)[] = [];
  private pending: { runId: number; resolve: (r: SandboxResult) => void } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  onConsole: ((e: ConsoleEntry) => void) | null = null;
  /** 渲染成功后又冒出的"运行时"错误（如点击后才崩）；用于实时错误浮层 */
  onLateError: ((r: { message: string; stack: string }) => void) | null = null;

  constructor(iframe: HTMLIFrameElement) {
    this.iframe = iframe;
    window.addEventListener("message", this.handle);
  }

  private handle = (e: MessageEvent) => {
    if (e.source !== this.iframe.contentWindow) return; // 只收自己这个 iframe 的
    const d = e.data;
    if (!d || typeof d !== "object") return;

    switch (d.type) {
      case "SANDBOX_READY":
        this.ready = true;
        this.readyWaiters.splice(0).forEach((fn) => fn());
        break;
      case "CONSOLE":
        this.onConsole?.({ level: d.level, text: d.text });
        break;
      case "RENDER_OK":
        this.settle(d.runId, { type: "RENDER_OK" });
        break;
      case "RUNTIME_ERROR":
        this.settle(d.runId, { type: "RUNTIME_ERROR", message: d.message, stack: d.stack });
        break;
    }
  };

  private settle(runId: unknown, r: SandboxResult) {
    if (typeof runId !== "number") return;
    if (this.pending) {
      if (this.pending.runId !== runId) return;
      if (this.timer) clearTimeout(this.timer);
      const p = this.pending.resolve;
      this.pending = null;
      this.timer = null;
      if (r.type === "RENDER_OK") this.lastSuccessfulRunId = runId;
      p(r);
    } else if (r.type === "RUNTIME_ERROR" && this.lastSuccessfulRunId === runId) {
      // 没有等待者却报错 = 渲染成功后用户交互触发的"晚到错误"
      this.onLateError?.({ message: r.message, stack: r.stack });
    }
  }

  private interruptPending(message: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const pending = this.pending;
    this.pending = null;
    pending?.resolve({ type: "RUNTIME_ERROR", message, stack: "" });
  }

  private whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((res) => this.readyWaiters.push(res));
  }

  private reloadRunner() {
    this.ready = false;
    this.runnerLoaded = true;
    this.readyWaiters = [];
    this.iframe.srcdoc = RUNNER_HTML;
  }

  private shouldReloadRunner(project: CompiledProject) {
    const nextImportMapKey = JSON.stringify(project.importMap ?? { imports: {} });
    if (!this.runnerLoaded) {
      this.importMapKey = nextImportMapKey;
      return true;
    }
    if (this.importMapKey !== nextImportMapKey) {
      this.importMapKey = nextImportMapKey;
      return true;
    }
    return false;
  }

  /** 注入项目编译产物执行，等沙箱回 RENDER_OK / RUNTIME_ERROR / 超时 */
  async run(project: CompiledProject): Promise<SandboxResult> {
    this.interruptPending("预览已被新的运行打断");
    if (this.shouldReloadRunner(project)) {
      this.reloadRunner();
      await this.whenReady();
    }
    const runId = ++this.nextRunId;
    return new Promise<SandboxResult>((resolve) => {
      this.pending = { runId, resolve };
      this.timer = setTimeout(() => {
        if (this.pending?.runId !== runId) return;
        this.pending = null;
        this.timer = null;
        resolve({ type: "RUNTIME_ERROR", message: "渲染超时（依赖加载过慢、网络失败或疑似死循环）", stack: "" });
      }, RUN_TIMEOUT_MS);
      this.iframe.contentWindow?.postMessage({ type: "RUN", runId, project }, "*");
    });
  }

  dispose() {
    this.interruptPending("预览控制器已释放");
    window.removeEventListener("message", this.handle);
  }
}
