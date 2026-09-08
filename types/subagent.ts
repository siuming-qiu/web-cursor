/**
 * [INPUT]: 已验证的 Sub-agent profile、任务身份与进程内执行结果
 * [OUTPUT]: Sub-agent Runtime 的严格有限集合、公共活动事件和只读快照类型
 * [POS]: Sub-agent 控制与观察协议的共享类型边界；不暴露私有 transcript/scope
 * [PROTOCOL]: Profile/status/activity 未知值必须失败；任务结果以终态判别联合表达
 */
import { z } from "zod";
import { ToolCallIdSchema, ToolCallNameSchema } from "./tool";

export const SubagentProfileId = {
  Explorer: "explorer",
} as const;

export const SubagentProfileIdSchema = z.enum(SubagentProfileId);
export type SubagentProfileId =
  typeof SubagentProfileId[keyof typeof SubagentProfileId];

export const SubagentTaskStatus = {
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Interrupted: "interrupted",
} as const;

export const SubagentTaskStatusSchema = z.enum(SubagentTaskStatus);
export type SubagentTaskStatus =
  typeof SubagentTaskStatus[keyof typeof SubagentTaskStatus];

export const SubagentActivityKind = {
  Started: "started",
  Snapshot: "snapshot",
  ModelStarted: "model_started",
  ToolStarted: "tool_started",
  ToolFinished: "tool_finished",
  ModelOutput: "model_output",
  StatusChanged: "status_changed",
} as const;

export type SubagentActivityKind =
  typeof SubagentActivityKind[keyof typeof SubagentActivityKind];

const SubagentAgentIdSchema = z.string().uuid();
const SubagentTaskDescriptionSchema = z.string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "subagent task must contain non-whitespace text",
  });

export const SubagentToolStatus = {
  Ok: "ok",
  Error: "error",
} as const;

export const SubagentFailureCode = {
  MaxModelRounds: "max_model_rounds",
  ModelRequestFailed: "model_request_failed",
  ExecutionFailed: "execution_failed",
} as const;

export const SubagentFailureSchema = z.discriminatedUnion("code", [
  z.object({
    code: z.literal(SubagentFailureCode.MaxModelRounds),
    message: z.literal("Sub-agent reached the model round limit before completing its task."),
  }).strict(),
  z.object({
    code: z.literal(SubagentFailureCode.ModelRequestFailed),
    message: z.literal("Sub-agent model request failed. Check the server logs for details."),
  }).strict(),
  z.object({
    code: z.literal(SubagentFailureCode.ExecutionFailed),
    message: z.literal("Sub-agent execution failed. Check the server logs for details."),
  }).strict(),
]);
export type SubagentFailure = z.infer<typeof SubagentFailureSchema>;

const ModelStartedSchema = z.object({
  kind: z.literal(SubagentActivityKind.ModelStarted),
  round: z.number().int().positive(),
}).strict();
const ModelOutputSchema = z.object({
  kind: z.literal(SubagentActivityKind.ModelOutput),
}).strict();
const ToolStartedSchema = z.object({
  kind: z.literal(SubagentActivityKind.ToolStarted),
  toolCallId: ToolCallIdSchema,
  toolName: ToolCallNameSchema,
  detail: z.string().min(1).optional(),
}).strict();
const ToolFinishedSchema = z.object({
  kind: z.literal(SubagentActivityKind.ToolFinished),
  toolCallId: ToolCallIdSchema,
  status: z.enum(SubagentToolStatus),
}).strict();

export const SubagentProgressSchema = z.discriminatedUnion("kind", [
  ModelStartedSchema,
  ModelOutputSchema,
  ToolStartedSchema,
  ToolFinishedSchema,
]);
export type SubagentProgress = z.infer<typeof SubagentProgressSchema>;

const SubagentObservedStateShape = {
  agentId: SubagentAgentIdSchema,
  status: SubagentTaskStatusSchema,
  failure: SubagentFailureSchema.optional(),
};

export const SubagentActivitySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(SubagentActivityKind.Started),
    agentId: SubagentAgentIdSchema,
    profileId: SubagentProfileIdSchema,
    task: SubagentTaskDescriptionSchema,
  }).strict(),
  ModelStartedSchema.extend({ agentId: SubagentAgentIdSchema }),
  ModelOutputSchema.extend({ agentId: SubagentAgentIdSchema }),
  ToolStartedSchema.extend({ agentId: SubagentAgentIdSchema }),
  ToolFinishedSchema.extend({ agentId: SubagentAgentIdSchema }),
  z.object({
    kind: z.literal(SubagentActivityKind.StatusChanged),
    ...SubagentObservedStateShape,
  }).strict(),
  z.object({
    kind: z.literal(SubagentActivityKind.Snapshot),
    ...SubagentObservedStateShape,
    profileId: SubagentProfileIdSchema,
    task: SubagentTaskDescriptionSchema,
    progress: z.array(SubagentProgressSchema),
  }).strict(),
]).superRefine((activity, context) => {
  if (activity.kind !== SubagentActivityKind.StatusChanged
    && activity.kind !== SubagentActivityKind.Snapshot) return;
  if ((activity.status === SubagentTaskStatus.Failed) !== !!activity.failure) {
    context.addIssue({
      code: "custom",
      path: ["failure"],
      message: "failure is required only for failed Sub-agent activity",
    });
  }
});

export type SubagentActivity = z.infer<typeof SubagentActivitySchema>;

export const SubagentTaskSnapshotSchema = z.object({
  taskId: z.string().uuid(),
  parentTaskId: z.string().uuid(),
  rootTaskId: z.string().uuid(),
  ownerId: z.string().uuid(),
  projectId: z.string().uuid(),
  depth: z.number().int().nonnegative(),
  profileId: SubagentProfileIdSchema,
  status: SubagentTaskStatusSchema,
}).strict();

export type SubagentTaskSnapshot = z.infer<
  typeof SubagentTaskSnapshotSchema
>;

export type TrustedSubagentCallerScope = Readonly<Pick<
  SubagentTaskSnapshot,
  "taskId" | "rootTaskId" | "ownerId" | "projectId" | "depth"
>>;

export type SubagentTaskResultSnapshot<TResult> =
  | Readonly<{
      taskId: string;
      status: typeof SubagentTaskStatus.Completed;
      result: TResult;
    }>
  | Readonly<{
      taskId: string;
      status: typeof SubagentTaskStatus.Failed;
      error: unknown;
    }>
  | Readonly<{
      taskId: string;
      status: typeof SubagentTaskStatus.Interrupted;
    }>;

export const SubagentMailboxDeliveryKind = {
  Message: "message",
  FollowupTask: "followup_task",
} as const;

export type SubagentMailboxDeliveryKind =
  typeof SubagentMailboxDeliveryKind[
    keyof typeof SubagentMailboxDeliveryKind
  ];

export type SubagentMailboxDelivery = Readonly<{
  kind: SubagentMailboxDeliveryKind;
  message: string;
  triggerTurn: boolean;
}>;

export const SubagentTaskEventType = {
  StatusChanged: "status_changed",
  TranscriptAppended: "transcript_appended",
  MailboxEnqueued: "mailbox_enqueued",
  MailboxDrained: "mailbox_drained",
  Progress: "progress",
} as const;

export type SubagentTaskEventType =
  typeof SubagentTaskEventType[keyof typeof SubagentTaskEventType];

export type SubagentTaskEvent<TTranscriptEntry, TProgressEvent> =
  | Readonly<{
      type: typeof SubagentTaskEventType.StatusChanged;
      snapshot: SubagentTaskSnapshot;
    }>
  | Readonly<{
      type: typeof SubagentTaskEventType.TranscriptAppended;
      snapshot: SubagentTaskSnapshot;
      entry: TTranscriptEntry;
    }>
  | Readonly<{
      type: typeof SubagentTaskEventType.MailboxEnqueued;
      snapshot: SubagentTaskSnapshot;
      delivery: SubagentMailboxDelivery;
    }>
  | Readonly<{
      type: typeof SubagentTaskEventType.MailboxDrained;
      snapshot: SubagentTaskSnapshot;
      deliveries: readonly SubagentMailboxDelivery[];
    }>
  | Readonly<{
      type: typeof SubagentTaskEventType.Progress;
      snapshot: SubagentTaskSnapshot;
      progress: TProgressEvent;
    }>;
