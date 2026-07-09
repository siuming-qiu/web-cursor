import { z } from "zod";
import { ChatAttachmentRefSchema } from "./attachment";
import { ToolResultSchema } from "./toolSchema";
import type { PendingImageJob } from "./image";
import type { IntegrationCardMeta } from "./integration";
import { ToolName, type ToolName as ToolNameType } from "./tool";

export const ChatTurnSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    message: z.string().min(1),
    projectId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
    attachments: z.array(ChatAttachmentRefSchema).max(4).optional(),
  }).strict(),
  z.object({
    kind: z.literal("resume"),
    conversationId: z.string().uuid(),
  }).strict(),
  z.object({
    kind: z.literal("preview_feedback"),
    conversationId: z.string().uuid(),
    result: ToolResultSchema,
  }).strict(),
]);

export type ChatTurn = z.infer<typeof ChatTurnSchema>;

export const ChatEventType = {
  Init: "init",
  Code: "code",
  Chat: "chat",
  ToolsCall: "tools_call",
  FileWriteStream: "file_write_stream",
  ToolResult: "tool_result",
  ToolPending: "tool_pending",
  FilesChanged: "files_changed",
  IntegrationCard: "integration_card",
  Title: "title",
  Done: "done",
  Error: "error",
} as const;

export type ChatEventType = typeof ChatEventType[keyof typeof ChatEventType];

export const FileChangeOperation = {
  Write: "write",
  Delete: "delete",
  Rename: "rename",
} as const;

export type FileChangeOperation =
  typeof FileChangeOperation[keyof typeof FileChangeOperation];

export type ChatEvent =
  | { type: typeof ChatEventType.Init; conversationId: string; projectId: string }
  // 旧前端仍会处理 code；新后端不再发送，等前端切到 files/tool events 后删除。
  | { type: typeof ChatEventType.Code; delta: string }
  | { type: typeof ChatEventType.Chat; delta: string }
  | { type: typeof ChatEventType.ToolsCall; index: number; name: ToolNameType | string; id: string }
  | { type: typeof ChatEventType.FileWriteStream; toolCallId: string; path?: string; delta?: string }
  | { type: typeof ChatEventType.ToolResult; name: ToolNameType | string; status: "ok" | "error" }
  | {
      type: typeof ChatEventType.ToolPending;
      id: string;
      name: typeof ToolName.GenerateImage;
      runId: string;
      jobs: PendingImageJob[];
    }
  | { type: typeof ChatEventType.IntegrationCard; meta: IntegrationCardMeta }
  | {
      type: typeof ChatEventType.FilesChanged;
      operation?: FileChangeOperation;
      path?: string;
      oldPath?: string;
    }
  | {
      type: typeof ChatEventType.Title;
      conversationId: string;
      title: string;
      projectTitle?: string;
      conversationTitle?: string;
    }
  | { type: typeof ChatEventType.Done }
  | { type: typeof ChatEventType.Error; message: string };
