/**
 * [INPUT]: WebContainer preview project files, iframe message data, and a preview run id
 * [OUTPUT]: preview-only runtime reporter injection, strict iframe message parsing, and run-scoped preview URLs
 * [POS]: C 域沙箱 → B 域编排的浏览器运行结果协议
 * [PROTOCOL]: 仅使用本文件定义的 channel/version/type/runId；未知消息直接拒绝，不修改持久化项目文件。
 */
"use client";

import { z } from "zod";
import { WebContainerUserError, type WebContainerProjectFile } from "@/lib/webcontainer/types";

export const PREVIEW_RUNTIME_CHANNEL = "web-cursor-preview-runtime";
export const PREVIEW_RUNTIME_VERSION = 1;
export const PREVIEW_RUNTIME_RUN_ID_QUERY = "__web_cursor_run_id";
export const PREVIEW_RUNTIME_OBSERVATION_MS = 1000;
export const PREVIEW_RUNTIME_RESULT_TIMEOUT_MS = 10000;

export const PreviewRuntimeMessageType = {
  RenderOk: "RENDER_OK",
  RuntimeError: "RUNTIME_ERROR",
} as const;

const PreviewRuntimeMessageBaseSchema = z.object({
  channel: z.literal(PREVIEW_RUNTIME_CHANNEL),
  version: z.literal(PREVIEW_RUNTIME_VERSION),
  runId: z.string().min(1),
});

export const PreviewRuntimeMessageSchema = z.discriminatedUnion("type", [
  PreviewRuntimeMessageBaseSchema.extend({
    type: z.literal(PreviewRuntimeMessageType.RenderOk),
  }).strict(),
  PreviewRuntimeMessageBaseSchema.extend({
    type: z.literal(PreviewRuntimeMessageType.RuntimeError),
    message: z.string().min(1),
    stack: z.string().optional(),
  }).strict(),
]);

export type PreviewRuntimeMessage = z.infer<typeof PreviewRuntimeMessageSchema>;

export function parsePreviewRuntimeMessage(data: unknown): PreviewRuntimeMessage | null {
  const parsed = PreviewRuntimeMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

function reporterScript() {
  const config = JSON.stringify({
    channel: PREVIEW_RUNTIME_CHANNEL,
    version: PREVIEW_RUNTIME_VERSION,
    runIdQuery: PREVIEW_RUNTIME_RUN_ID_QUERY,
    renderOk: PreviewRuntimeMessageType.RenderOk,
    runtimeError: PreviewRuntimeMessageType.RuntimeError,
    observationMs: PREVIEW_RUNTIME_OBSERVATION_MS,
  }).replace(/</g, "\\u003c");

  return `(() => {
  const config = ${config};
  const runId = new URL(window.location.href).searchParams.get(config.runIdQuery);
  if (!runId) return;

  let failed = false;
  const post = (payload) => window.parent.postMessage({
    channel: config.channel,
    version: config.version,
    runId,
    ...payload,
  }, "*");

  const report = (message, stack) => {
    if (failed) return;
    failed = true;
    post({
      type: config.runtimeError,
      message: message || "Unknown browser runtime error",
      ...(stack ? { stack } : {}),
    });
  };

  window.addEventListener("error", (event) => {
    if (!(event instanceof ErrorEvent)) return;
    const error = event.error instanceof Error ? event.error : null;
    report(error?.message || event.message, error?.stack);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const error = event.reason instanceof Error ? event.reason : null;
    report(error?.message || String(event.reason ?? "Unhandled promise rejection"), error?.stack);
  });

  window.addEventListener("load", () => {
    window.setTimeout(() => {
      if (!failed) post({ type: config.renderOk });
    }, config.observationMs);
  }, { once: true });
})();`;
}

function injectReporter(indexHtml: string) {
  const tag = `<script data-web-cursor-runtime-bridge>${reporterScript()}</script>`;
  const head = /<head(?:\s[^>]*)?>/i;
  if (head.test(indexHtml)) return indexHtml.replace(head, (match) => `${match}${tag}`);

  const body = /<body(?:\s[^>]*)?>/i;
  if (body.test(indexHtml)) return indexHtml.replace(body, (match) => `${match}${tag}`);

  const doctype = /^\s*<!doctype[^>]*>/i;
  if (doctype.test(indexHtml)) return indexHtml.replace(doctype, (match) => `${match}${tag}`);
  return `${tag}${indexHtml}`;
}

export function withPreviewRuntimeBridge(files: WebContainerProjectFile[]): WebContainerProjectFile[] {
  const indexFiles = files.filter((file) => file.path === "index.html");
  if (indexFiles.length !== 1) {
    throw new WebContainerUserError(`预览需要且只能有一个 index.html，当前数量：${indexFiles.length}`);
  }

  return files.map((file) => file.path === "index.html"
    ? { ...file, content: injectReporter(file.content) }
    : file
  );
}

export function withPreviewRunId(url: string, runId: number) {
  const previewUrl = new URL(url);
  previewUrl.searchParams.set(PREVIEW_RUNTIME_RUN_ID_QUERY, String(runId));
  return previewUrl.toString();
}
