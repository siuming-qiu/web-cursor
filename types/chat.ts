import { z } from "zod";
import { ChatAttachmentRefSchema } from "./attachment";
import type { ToolName } from "./tool";

export const ChatTurnSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    message: z.string().min(1),
    projectId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
    attachments: z.array(ChatAttachmentRefSchema).max(4).optional(),
  }),
  z.object({
    kind: z.literal("resume"),
    conversationId: z.string().uuid(),
  }),
]);

export type ChatTurn = z.infer<typeof ChatTurnSchema>;

export const ChatEventType = {
  Init: "init",
  Code: "code",
  Chat: "chat",
  ToolsCall: "tools_call",
  ToolResult: "tool_result",
  FilesChanged: "files_changed",
  Title: "title",
  Done: "done",
  Error: "error",
} as const;

export type ChatEventType = typeof ChatEventType[keyof typeof ChatEventType];

export type ChatEvent =
  | { type: typeof ChatEventType.Init; conversationId: string; projectId: string }
  // 旧前端仍会处理 code；新后端不再发送，等前端切到 files/tool events 后删除。
  | { type: typeof ChatEventType.Code; delta: string }
  | { type: typeof ChatEventType.Chat; delta: string }
  | { type: typeof ChatEventType.ToolsCall; index: number; name: ToolName | string; id: string }
  | { type: typeof ChatEventType.ToolResult; name: ToolName | string; status: "ok" | "error" }
  | { type: typeof ChatEventType.FilesChanged }
  | {
      type: typeof ChatEventType.Title;
      conversationId: string;
      title: string;
      projectTitle?: string;
      conversationTitle?: string;
    }
  | { type: typeof ChatEventType.Done }
  | { type: typeof ChatEventType.Error; message: string };
