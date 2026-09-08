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
import type { ContextCompactionPhase } from "@/types/chat";
import type {
  SubagentFailure,
  SubagentProfileId,
  SubagentTaskStatus,
  SubagentToolStatus,
} from "@/types/subagent";

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

export type FileWriteStreamView = {
  toolCallId: string;
  path?: string;
  content: string;
  collapsed?: boolean;
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
  agentRunId?: string | null;
  toolCallId: string;
  status: ImageRunStatus;
  jobs: ImageJobView[];
  result?: GenerateImageRunResult | null;
  error?: ImageJobError | null;
  resumeOnTerminal?: boolean;
};

export const SubagentActivityViewKind = {
  Started: "started",
  ModelStarted: "model_started",
  ToolStarted: "tool_started",
  ModelOutput: "model_output",
} as const;

export type SubagentActivityView =
  | {
      id: string;
      kind: typeof SubagentActivityViewKind.Started;
    }
  | {
      id: string;
      kind: typeof SubagentActivityViewKind.ModelStarted;
      round: number;
    }
  | {
      id: string;
      kind: typeof SubagentActivityViewKind.ToolStarted;
      toolCallId: string;
      toolName: string;
      detail?: string;
      result?: typeof SubagentToolStatus[keyof typeof SubagentToolStatus];
    }
  | {
      id: string;
      kind: typeof SubagentActivityViewKind.ModelOutput;
    };

export const SubagentObservationStatus = {
  Live: "live",
  Disconnected: "disconnected",
} as const;

export type SubagentRunView = {
  agentId: string;
  profileId: SubagentProfileId;
  task: string;
  status: SubagentTaskStatus;
  failure?: SubagentFailure;
  observation: {
    transportId: string;
    status: typeof SubagentObservationStatus[keyof typeof SubagentObservationStatus];
  };
  activities: SubagentActivityView[];
};

export const AiTimelineItemKind = {
  Chat: "chat",
  ContextCompaction: "context_compaction",
  FileWriteStream: "file_write_stream",
  FileChange: "file_change",
  ImageRun: "image_run",
  SubagentRun: "subagent_run",
} as const;

export type AiTimelineItem =
  | {
      id: string;
      kind: typeof AiTimelineItemKind.Chat;
      start: number;
      end: number;
      receivedAt: number;
      order: number;
    }
  | {
      id: string;
      kind: typeof AiTimelineItemKind.ContextCompaction;
      phase: ContextCompactionPhase;
      receivedAt: number;
      order: number;
    }
  | {
      id: string;
      kind: typeof AiTimelineItemKind.FileWriteStream;
      toolCallId: string;
      receivedAt: number;
      order: number;
    }
  | {
      id: string;
      kind: typeof AiTimelineItemKind.FileChange;
      changeId: string;
      receivedAt: number;
      order: number;
    }
  | {
      id: string;
      kind: typeof AiTimelineItemKind.ImageRun;
      runId: string;
      receivedAt: number;
      order: number;
    }
  | {
      id: string;
      kind: typeof AiTimelineItemKind.SubagentRun;
      agentId: string;
      receivedAt: number;
      order: number;
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
      fileWriteStreams?: FileWriteStreamView[];
      imageRuns?: ImageRunView[];
      subagentRuns?: SubagentRunView[];
      integrationCard?: IntegrationCardMeta;
      timeline?: AiTimelineItem[];
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
