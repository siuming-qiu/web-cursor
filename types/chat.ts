/**
 * [INPUT]: Chat request turns and raw SSE event payloads
 * [OUTPUT]: Strict ChatTurn/ChatEvent runtime schemas and inferred protocol types
 * [POS]: Shared A/B-domain chat and AgentRun streaming protocol boundary
 * [PROTOCOL]: Every SSE event carries AgentRun identity; unknown fields and mismatched run snapshots fail closed
 */
import { z } from "zod";
import {
  AgentRunIdSchema,
  AgentRunRequestIdSchema,
  AgentRunSnapshotSchema,
} from "./agentRun";
import { ChatAttachmentRefSchema } from "./attachment";
import { ClientToolCallSchema } from "./clientTool";
import { IntegrationCardMetaSchema } from "./integration";
import { ProjectFileOperation } from "./projectFileMutation";
import { ProjectRepositoryDescriptorSchema } from "./projectRepository";
import { SubagentActivitySchema } from "./subagent";
import { ToolCallIdSchema, ToolCallNameSchema, ToolName } from "./tool";
import { GenerateImageItemSchema, ToolResultSchema } from "./toolSchema";

const AgentRunAttemptSchema = z.number().int().positive();

export const ChatTurnSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    message: z.string().min(1),
    projectId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
    attachments: z.array(ChatAttachmentRefSchema).max(4).optional(),
    requestId: AgentRunRequestIdSchema,
    repository: ProjectRepositoryDescriptorSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("resume"),
    conversationId: z.string().uuid(),
    runId: AgentRunIdSchema,
    attempt: AgentRunAttemptSchema,
  }).strict(),
  z.object({
    kind: z.literal("preview_feedback"),
    conversationId: z.string().uuid(),
    runId: AgentRunIdSchema,
    attempt: AgentRunAttemptSchema,
    result: ToolResultSchema,
  }).strict(),
]);

export type ChatTurn = z.infer<typeof ChatTurnSchema>;

export const ChatEventType = {
  Init: "init",
  Code: "code",
  Chat: "chat",
  ToolsCall: "tools_call",
  ClientToolCalls: "client_tool_calls",
  FileWriteStream: "file_write_stream",
  ToolResult: "tool_result",
  ToolPending: "tool_pending",
  FilesChanged: "files_changed",
  IntegrationCard: "integration_card",
  ContextCompaction: "context_compaction",
  SubagentActivity: "subagent_activity",
  Title: "title",
  RunState: "run_state",
  Done: "done",
  Error: "error",
} as const;

export type ChatEventType = typeof ChatEventType[keyof typeof ChatEventType];

export const ContextCompactionPhase = {
  Started: "started",
  Completed: "completed",
} as const;

export type ContextCompactionPhase =
  typeof ContextCompactionPhase[keyof typeof ContextCompactionPhase];

export const FileChangeOperation = ProjectFileOperation;

export type FileChangeOperation =
  typeof FileChangeOperation[keyof typeof FileChangeOperation];

const ChatToolResultStatus = {
  Ok: "ok",
  Error: "error",
} as const;

const ChatEventRunShape = {
  agentRunId: AgentRunIdSchema,
  attempt: AgentRunAttemptSchema,
};

const PendingImageJobSchema = GenerateImageItemSchema.extend({
  jobId: z.string().uuid(),
}).strict();

export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.Init),
    conversationId: z.string().uuid(),
    repository: ProjectRepositoryDescriptorSchema,
  }).strict(),
  // 旧前端仍会处理 code；新后端不再发送，等前端切到 files/tool events 后删除。
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.Code),
    delta: z.string(),
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.Chat),
    delta: z.string(),
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.ToolsCall),
    index: z.number().int().nonnegative(),
    name: ToolCallNameSchema,
    id: ToolCallIdSchema,
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.ClientToolCalls),
    calls: z.array(ClientToolCallSchema),
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.FileWriteStream),
    toolCallId: ToolCallIdSchema,
    path: z.string().optional(),
    delta: z.string().optional(),
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.ToolResult),
    name: ToolCallNameSchema,
    status: z.enum(ChatToolResultStatus),
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.ToolPending),
    id: ToolCallIdSchema,
    name: z.literal(ToolName.GenerateImage),
    runId: z.string().uuid(),
    jobs: z.array(PendingImageJobSchema),
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.IntegrationCard),
    meta: IntegrationCardMetaSchema,
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.ContextCompaction),
    phase: z.enum(ContextCompactionPhase),
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.SubagentActivity),
    activity: SubagentActivitySchema,
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.FilesChanged),
    operation: z.enum(FileChangeOperation).optional(),
    path: z.string().optional(),
    oldPath: z.string().optional(),
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.Title),
    conversationId: z.string().uuid(),
    title: z.string(),
    projectTitle: z.string().optional(),
    conversationTitle: z.string().optional(),
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.RunState),
    run: AgentRunSnapshotSchema,
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.Done),
  }).strict(),
  z.object({
    ...ChatEventRunShape,
    type: z.literal(ChatEventType.Error),
    message: z.string(),
  }).strict(),
]).superRefine((event, context) => {
  if (event.type !== ChatEventType.RunState) return;
  if (event.run.id !== event.agentRunId) {
    context.addIssue({
      code: "custom",
      path: ["run", "id"],
      message: "run.id must match agentRunId",
    });
  }
  if (event.run.attempt !== event.attempt) {
    context.addIssue({
      code: "custom",
      path: ["run", "attempt"],
      message: "run.attempt must match attempt",
    });
  }
});

export type ChatEvent = z.infer<typeof ChatEventSchema>;
