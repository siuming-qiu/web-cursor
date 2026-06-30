/** agent 运行过程在 UI 上的状态模型，组件与 useChat 共享。 */

import type { AttachmentSummary } from "@/types/attachment";
import type {
  GenerateImageItemInput,
  GenerateImageJobResult,
  GenerateImageRunResult,
  ImageJobError,
  ImageJobStatus,
  ImageRunStatus,
} from "@/types/image";
import type { IntegrationCardMeta } from "@/types/integration";

export type Phase =
  | "writing"
  | "transpiling"
  | "running"
  | "ok"
  | "compile-fail"
  | "runtime-fail";

export interface Attempt {
  n: number;
  phase: Phase;
  note?: string;
}

export type AgentFileChange = {
  id: string;
  operation: "write" | "delete" | "rename";
  path: string;
  oldPath?: string;
};

export type ImageJobView = {
  id: string;
  status: ImageJobStatus;
  input: GenerateImageItemInput;
  result?: GenerateImageJobResult | null;
  error?: ImageJobError | null;
};

export type ImageRunView = {
  runId: string;
  toolCallId: string;
  status: ImageRunStatus;
  jobs: ImageJobView[];
  result?: GenerateImageRunResult | null;
  error?: ImageJobError | null;
  resumeOnTerminal?: boolean;
};

export type UserMessageAttachment = AttachmentSummary & {
  name?: string;
  previewUrl?: string;
};

export type SendAttachment = {
  id: string;
  name: string;
  type: "image";
  mimeType: UserMessageAttachment["mimeType"];
  sizeBytes: number;
  previewUrl: string;
};

export type Message =
  | { id: string; role: "user"; text: string; attachments?: UserMessageAttachment[] }
  | {
      id: string;
      role: "ai";
      attempts: Attempt[];
      summary?: string;
      summaryKind?: "ok" | "fail";
      diff?: string;
      chatText?: string; // AI 直接回话/提问（reply），非写代码时显示
      fileChanges?: AgentFileChange[];
      imageRuns?: ImageRunView[];
      integrationCard?: IntegrationCardMeta;
    };

export interface Status {
  kind: "" | "load" | "ok" | "err";
  text: string;
  meta?: string;
}

export interface Overlay {
  show: boolean;
  title?: string;
  message: string;
  stack: string;
  showStack: boolean;
}

export const PHASE_LABEL: Record<Phase, string> = {
  writing: "✍️ 写代码…",
  transpiling: "🔧 转译中…",
  running: "▶️ 执行中…",
  ok: "✓ 渲染成功",
  "compile-fail": "✕ 编译报错",
  "runtime-fail": "✕ 运行报错",
};
