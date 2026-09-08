/**
 * [INPUT]: trusted Parent scope, strict control-tool args, Explorer Profile, shared Agent Runner
 * [OUTPUT]: process-local Child handles/results、真实执行活动与可重新订阅的安全快照
 * [POS]: A domain Sub-agent composition root; owns the singleton in-memory Runtime and Child Host
 * [PROTOCOL]: request/SSE signals may cancel wait only; only interrupt aborts the Child controller;
 *   activity subscribe happens only after spawn commit; reconnect snapshots stay process-local;
 *   observers cannot fail the Child and public failures never contain raw provider errors;
 *   first-phase Child is fresh, Database-only, read-only, depth 1, and one active Child per Parent
 */
import "server-only";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import type { AppLocale } from "@/i18n/locales";
import {
  AgentLoopControl,
  AgentLoopLimitError,
  runAgentLoop,
  type AgentLoopHost,
  type AgentModelObserver,
} from "@/server/agentRunner";
import {
  AgentTaskRuntime,
  AgentTaskRuntimeError,
  AgentTaskRuntimeErrorCode,
  type AgentTaskExecutionContext,
  type PreparedAgentTaskAction,
} from "@/server/agentTaskRuntime";
import {
  resolveSubagentProfile,
  type ResolvedSubagentProfile,
} from "@/server/agentProfiles";
import {
  executeToolCall,
  ToolExecutionErrorCode,
  type SubagentToolControl,
  type ToolExecutionResult,
} from "@/server/tools/executor";
import { AgentToolExecutionDomain } from "@/types/agentRun";
import { ProjectStorageKind, type ProjectStorageKind as ProjectStorageKindValue } from "@/types/projectStorage";
import {
  SubagentActivityKind,
  SubagentFailureCode,
  SubagentTaskEventType,
  SubagentTaskStatus,
  SubagentToolStatus,
  type SubagentActivity,
  type SubagentFailure,
  type SubagentMailboxDelivery,
  type SubagentProfileId,
  type SubagentProgress,
  type SubagentTaskEvent,
  type TrustedSubagentCallerScope,
} from "@/types/subagent";
import { ToolName, type ToolCallMeta } from "@/types/tool";
import {
  ListFilesArgsSchema,
  ReadFileArgsSchema,
  SearchTextArgsSchema,
} from "@/types/toolSchema";

type ModelMessages = ChatCompletionCreateParamsStreaming["messages"];

type ChildTaskInput = Readonly<{
  message: string;
  locale: AppLocale;
}>;

type ChildTranscriptEntry =
  | Readonly<{ role: "user"; content: string; source: "spawn" | SubagentMailboxDelivery["kind"] }>
  | Readonly<{ role: "assistant"; content: string; toolCalls?: readonly ToolCallMeta[] }>
  | Readonly<{ role: "tool"; toolCallId: string; content: string }>;

type ChildToolTranscriptEntry = Extract<
  ChildTranscriptEntry,
  { role: "tool" }
>;

type ChildProgressEvent = SubagentProgress;

class ChildModelRequestError extends Error {
  constructor(cause: unknown) {
    super("Sub-agent model request failed.", { cause });
    this.name = "ChildModelRequestError";
  }
}

type ChildInvocation = Readonly<{
  executionDomain: typeof AgentToolExecutionDomain.Server;
  toolCall: ToolCallMeta;
  allowed: boolean;
}>;

type ChildExecutionContext = AgentTaskExecutionContext<
  ChildTaskInput,
  ChildTranscriptEntry,
  ChildProgressEvent
>;

type ChildLoopState = {
  modelRound: number;
  convergenceMessageSent: boolean;
  output: string | null;
  pendingToolRound: Readonly<{
    text: string;
    toolCalls: readonly ToolCallMeta[];
  }> | null;
};

type SubagentControlBinding = Readonly<{
  caller: TrustedSubagentCallerScope;
  locale: AppLocale;
  storageKind: ProjectStorageKindValue;
  activitySink?: SubagentActivitySink;
  registerActivitySubscription?: RegisterSubagentActivitySubscription;
}>;

export type SubagentActivitySink = (activity: SubagentActivity) => void;

export type RegisterSubagentActivitySubscription = (
  agentId: string,
  unsubscribe: () => void,
) => (() => void) | null;

type PendingSpawnActivity = Readonly<{
  agentId: string;
  profileId: SubagentProfileId;
  task: string;
}>;

export const FirstPhaseSubagentRuntimeLimits = {
  MaxDepth: 1,
  MaxActiveChildrenPerParent: 1,
} as const;

function appendConvergenceMessage(input: {
  messages: ModelMessages;
  profile: ResolvedSubagentProfile;
  state: ChildLoopState;
}): void {
  if (
    input.state.convergenceMessageSent
    || input.state.modelRound < input.profile.runtimeBudget.softModelRounds
  ) {
    return;
  }
  input.messages.push({
    role: "system",
    content: input.profile.runtimeBudget.convergenceMessage,
  });
  input.state.convergenceMessageSent = true;
}

function genericToolError(
  tool: string,
  code: typeof ToolExecutionErrorCode[keyof typeof ToolExecutionErrorCode],
  message: string,
): ToolExecutionResult {
  return { status: "error", tool, code, message };
}

function appendMailboxMessages(
  context: ChildExecutionContext,
  messages: ModelMessages,
): boolean {
  return appendMailboxDeliveries(context, messages, context.drainMailbox());
}

function appendMailboxDeliveries(
  context: ChildExecutionContext,
  messages: ModelMessages,
  deliveries: readonly SubagentMailboxDelivery[],
): boolean {
  context.signal.throwIfAborted();
  for (const delivery of deliveries) {
    messages.push({ role: "user", content: delivery.message });
    context.appendTranscript({
      role: "user",
      content: delivery.message,
      source: delivery.kind,
    });
  }
  return deliveries.length > 0;
}

function appendToolMessage(input: {
  context: ChildExecutionContext;
  messages: ModelMessages;
  invocation: ChildInvocation;
  result: ToolExecutionResult;
}): ChildToolTranscriptEntry {
  input.context.signal.throwIfAborted();
  const content = JSON.stringify(input.result);
  input.messages.push({
    role: "tool",
    tool_call_id: input.invocation.toolCall.id,
    content,
  });
  return {
    role: "tool",
    toolCallId: input.invocation.toolCall.id,
    content,
  };
}

function commitChildToolRound(
  context: ChildExecutionContext,
  state: ChildLoopState,
  toolResults: readonly ChildToolTranscriptEntry[],
): void {
  const round = state.pendingToolRound;
  if (!round) {
    throw new Error("Child tool round closed without a pending assistant call.");
  }
  context.appendTranscriptBatch([
    { role: "assistant", content: round.text, toolCalls: round.toolCalls },
    ...toolResults,
  ]);
  state.pendingToolRound = null;
}

function childObserver(
  context: ChildExecutionContext,
  state: ChildLoopState,
): AgentModelObserver {
  let announcedOutputRound = 0;
  return {
    onTextDelta() {
      if (announcedOutputRound === state.modelRound) return;
      announcedOutputRound = state.modelRound;
      context.publishProgress({ kind: SubagentActivityKind.ModelOutput });
    },
    onToolCallStarted() {
      // A streamed tool name is intent, not execution. The Host publishes start
      // only after the complete arguments pass the tool's authoritative schema.
    },
    onFileWriteDelta() {
      // Explorer never exposes write_file. A model-emitted write call is closed
      // as an explicit disallowed-tool result by the Child Host.
    },
  };
}

async function recordChildAssistantReply(input: {
  context: ChildExecutionContext;
  messages: ModelMessages;
  state: ChildLoopState;
  text: string;
}): Promise<AgentLoopControl> {
  input.context.signal.throwIfAborted();
  if (input.state.pendingToolRound) {
    throw new Error("Child produced a final reply while a tool round was still open.");
  }
  input.messages.push({ role: "assistant", content: input.text });
  input.context.appendTranscript({ role: "assistant", content: input.text });
  const deliveries = await input.context.drainMailboxAtCompletion();
  if (appendMailboxDeliveries(input.context, input.messages, deliveries)) {
    return AgentLoopControl.Continue;
  }
  input.state.output = input.text;
  return AgentLoopControl.Stop;
}

function recordChildToolRound(input: {
  context: ChildExecutionContext;
  messages: ModelMessages;
  profile: ResolvedSubagentProfile;
  state: ChildLoopState;
  text: string;
  toolCalls: readonly ToolCallMeta[];
}): ChildInvocation[] {
  input.context.signal.throwIfAborted();
  if (input.state.pendingToolRound) {
    throw new Error("Child started a tool round before closing the previous round.");
  }
  input.messages.push({
    role: "assistant",
    content: input.text,
    tool_calls: input.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function" as const,
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    })),
  });
  input.state.pendingToolRound = {
    text: input.text,
    toolCalls: input.toolCalls,
  };
  return input.toolCalls.map((toolCall) => ({
    executionDomain: AgentToolExecutionDomain.Server,
    toolCall,
    allowed: input.profile.allowedTools.has(toolCall.name),
  }));
}

async function executeChildToolRound(input: {
  context: ChildExecutionContext;
  messages: ModelMessages;
  profile: ResolvedSubagentProfile;
  state: ChildLoopState;
  invocations: readonly ChildInvocation[];
}): Promise<AgentLoopControl> {
  const transcriptResults: ChildToolTranscriptEntry[] = [];
  for (const invocation of input.invocations) {
    input.context.signal.throwIfAborted();
    const result = invocation.allowed
      ? await executeObservedChildTool(input.context, invocation.toolCall)
      : genericToolError(
          invocation.toolCall.name,
          ToolExecutionErrorCode.BadArgs,
          `Tool is not allowed by the ${input.profile.id} Profile: ${invocation.toolCall.name}`,
        );
    if (result.status === "pending") {
      throw new Error("Read-only Child tool unexpectedly returned a pending result.");
    }
    transcriptResults.push(appendToolMessage({
      context: input.context,
      messages: input.messages,
      invocation,
      result,
    }));
  }
  commitChildToolRound(input.context, input.state, transcriptResults);
  return AgentLoopControl.Continue;
}

function childToolDetail(toolCall: ToolCallMeta): string | undefined {
  const args: unknown = JSON.parse(toolCall.arguments);
  switch (toolCall.name) {
    case ToolName.ListFiles:
      ListFilesArgsSchema.parse(args);
      return undefined;
    case ToolName.ReadFile:
      return ReadFileArgsSchema.parse(args).path;
    case ToolName.SearchText:
      return SearchTextArgsSchema.parse(args).query;
    default:
      throw new Error(`Missing activity argument contract for Child tool: ${toolCall.name}`);
  }
}

async function executeObservedChildTool(
  context: ChildExecutionContext,
  toolCall: ToolCallMeta,
): Promise<ToolExecutionResult> {
  let detail: string | undefined;
  try {
    detail = childToolDetail(toolCall);
  } catch (error) {
    return genericToolError(toolCall.name, ToolExecutionErrorCode.BadArgs, errorMessage(error));
  }
  context.publishProgress({
    kind: SubagentActivityKind.ToolStarted,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    ...(detail === undefined ? {} : { detail }),
  });
  let result: ToolExecutionResult;
  try {
    result = await executeToolCall(toolCall, {
      ownerId: context.task.ownerId,
      projectId: context.task.projectId,
      signal: context.signal,
    });
    if (result.status === "pending") {
      throw new Error("Read-only Child tool unexpectedly returned a pending result.");
    }
  } catch (error) {
    context.signal.throwIfAborted();
    context.publishProgress({
      kind: SubagentActivityKind.ToolFinished,
      toolCallId: toolCall.id,
      status: SubagentToolStatus.Error,
    });
    throw error;
  }
  context.signal.throwIfAborted();
  context.publishProgress({
    kind: SubagentActivityKind.ToolFinished,
    toolCallId: toolCall.id,
    status: result.status === "ok" ? SubagentToolStatus.Ok : SubagentToolStatus.Error,
  });
  return result;
}

function createChildAgentLoopHost(input: {
  context: ChildExecutionContext;
  messages: ModelMessages;
  profile: ResolvedSubagentProfile;
  state: ChildLoopState;
}): AgentLoopHost<number, ChildInvocation> {
  return {
    async prepareModelRound() {
      appendMailboxMessages(input.context, input.messages);
      appendConvergenceMessage(input);
      return input.messages;
    },
    async beginModelRound() {
      input.state.modelRound += 1;
      return input.state.modelRound;
    },
    async withModelRequest(signal, request) {
      signal.throwIfAborted();
      input.context.publishProgress({
        kind: SubagentActivityKind.ModelStarted,
        round: input.state.modelRound,
      });
      try {
        return await request(signal);
      } catch (error) {
        if (signal.aborted) throw error;
        throw new ChildModelRequestError(error);
      }
    },
    async recordAssistantReply(text) {
      return recordChildAssistantReply({ ...input, text });
    },
    async recordToolRound({ text, toolCalls }) {
      return recordChildToolRound({ ...input, text, toolCalls });
    },
    async updateContextBaseline() {
      // Fresh in-memory Child compaction is outside the first-phase contract.
    },
    async rejectInvalidToolRound({ invocations, message }) {
      const transcriptResults: ChildToolTranscriptEntry[] = [];
      for (const invocation of invocations) {
        transcriptResults.push(appendToolMessage({
          context: input.context,
          messages: input.messages,
          invocation,
          result: genericToolError(
            invocation.toolCall.name,
            ToolExecutionErrorCode.BadArgs,
            message,
          ),
        }));
      }
      commitChildToolRound(input.context, input.state, transcriptResults);
    },
    async executeToolRound({ invocations }) {
      return executeChildToolRound({ ...input, invocations });
    },
  };
}

async function executeChildTask(context: ChildExecutionContext): Promise<string> {
  const profile = resolveSubagentProfile({
    profileId: context.task.profileId,
    locale: context.input.locale,
    storageKind: ProjectStorageKind.Database,
  });
  const messages: ModelMessages = [
    { role: "system", content: profile.systemPrompt },
    { role: "user", content: context.input.message },
  ];
  context.appendTranscript({
    role: "user",
    content: context.input.message,
    source: "spawn",
  });
  const state: ChildLoopState = {
    modelRound: 0,
    convergenceMessageSent: false,
    output: null,
    pendingToolRound: null,
  };

  try {
    await runAgentLoop({
      harness: profile,
      host: createChildAgentLoopHost({ context, messages, profile, state }),
      observer: childObserver(context, state),
      signal: context.signal,
      maxModelRounds: profile.runtimeBudget.maxModelRounds,
    });
  } catch (error) {
    if (!context.signal.aborted) {
      console.warn("Sub-agent execution failed", { agentId: context.task.taskId, error });
    }
    throw error;
  }
  context.signal.throwIfAborted();
  if (state.output === null) {
    throw new Error("Child Agent loop stopped without a final assistant result.");
  }
  return state.output;
}

const runtime = new AgentTaskRuntime<
  ChildTaskInput,
  string,
  ChildTranscriptEntry,
  ChildProgressEvent
>({
  maxDepth: FirstPhaseSubagentRuntimeLimits.MaxDepth,
  maxActiveChildrenPerParent:
    FirstPhaseSubagentRuntimeLimits.MaxActiveChildrenPerParent,
  executeTask: executeChildTask,
});

function publishActivity(
  sink: SubagentActivitySink,
  activity: SubagentActivity,
): void {
  try {
    sink(activity);
  } catch (error) {
    console.warn("Failed to publish Sub-agent activity", error);
  }
}

function activityFromRuntimeEvent(
  caller: TrustedSubagentCallerScope,
  agentId: string,
  event: SubagentTaskEvent<ChildTranscriptEntry, ChildProgressEvent>,
): SubagentActivity | null {
  if (event.type === SubagentTaskEventType.StatusChanged) {
    return {
      kind: SubagentActivityKind.StatusChanged,
      agentId,
      status: event.snapshot.status,
      ...failureForResult(runtime.result(caller, agentId)),
    };
  }
  if (event.type !== SubagentTaskEventType.Progress) return null;
  return { ...event.progress, agentId };
}

function failureForResult(
  result: ReturnType<typeof runtime.result>,
): { failure?: SubagentFailure } {
  if (result?.status !== SubagentTaskStatus.Failed) return {};
  if (result.error instanceof AgentLoopLimitError) {
    return { failure: {
      code: SubagentFailureCode.MaxModelRounds,
      message: "Sub-agent reached the model round limit before completing its task.",
    } };
  }
  if (result.error instanceof ChildModelRequestError) {
    return { failure: {
      code: SubagentFailureCode.ModelRequestFailed,
      message: "Sub-agent model request failed. Check the server logs for details.",
    } };
  }
  return { failure: {
    code: SubagentFailureCode.ExecutionFailed,
    message: "Sub-agent execution failed. Check the server logs for details.",
  } };
}

type ActivityBinding = Pick<SubagentControlBinding,
  "caller" | "activitySink" | "registerActivitySubscription">;

export function subscribeExistingSubagentActivity(input: ActivityBinding): void {
  if (!input.activitySink || !input.registerActivitySubscription) return;
  for (const child of runtime.inspectChildren(input.caller)) {
    installActivitySubscription(input, {
      kind: SubagentActivityKind.Snapshot,
      agentId: child.snapshot.taskId,
      profileId: child.snapshot.profileId,
      task: child.input.message,
      status: child.snapshot.status,
      progress: [...child.progress],
      ...failureForResult(child.result),
    });
  }
}

function installActivitySubscription(
  input: ActivityBinding,
  initial: Extract<SubagentActivity, {
    kind: typeof SubagentActivityKind.Started | typeof SubagentActivityKind.Snapshot;
  }>,
): void {
  const sink = input.activitySink;
  const register = input.registerActivitySubscription;
  if (!sink || !register) return;
  if (initial.kind === SubagentActivityKind.Snapshot
    && initial.status !== SubagentTaskStatus.Running) {
    publishActivity(sink, initial);
    return;
  }

  let releaseSubscription: (() => void) | null = null;
  let unsubscribeRuntime: (() => void) | null = null;
  try {
    unsubscribeRuntime = runtime.subscribe(
      input.caller,
      initial.agentId,
      (event) => {
        const activity = activityFromRuntimeEvent(input.caller, initial.agentId, event);
        if (!activity) return;
        publishActivity(sink, activity);
        if (
          activity.kind === SubagentActivityKind.StatusChanged
          && activity.status !== SubagentTaskStatus.Running
        ) {
          try {
            releaseSubscription?.();
          } catch (error) {
            console.warn("Failed to release Sub-agent activity subscription", error);
          }
        }
      },
    );
    releaseSubscription = register(initial.agentId, unsubscribeRuntime);
    if (!releaseSubscription) {
      unsubscribeRuntime();
      return;
    }
  } catch (error) {
    try {
      unsubscribeRuntime?.();
    } catch {
      // Subscription setup already failed; cleanup must remain best-effort.
    }
    console.warn("Failed to subscribe to Sub-agent activity", error);
    return;
  }

  publishActivity(sink, initial);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runtimeErrorResult(tool: string, error: unknown): ToolExecutionResult {
  if (error instanceof AgentTaskRuntimeError) {
    const code = error.code === AgentTaskRuntimeErrorCode.NotFound
      ? ToolExecutionErrorCode.NotFound
      : error.code === AgentTaskRuntimeErrorCode.InvalidConfiguration
        ? ToolExecutionErrorCode.InternalError
        : ToolExecutionErrorCode.Conflict;
    return genericToolError(tool, code, error.message);
  }
  return genericToolError(
    tool,
    ToolExecutionErrorCode.InternalError,
    errorMessage(error),
  );
}

type StageAgentTaskAction = <TResult>(
  action: PreparedAgentTaskAction<TResult>,
) => TResult;

export type SubagentToolExecution = Readonly<{
  control: SubagentToolControl;
  commit(): void;
  rollback(): void;
}>;

function spawnAgent(
  input: SubagentControlBinding,
  args: Parameters<SubagentToolControl["spawn"]>[0],
  stage: StageAgentTaskAction,
): ToolExecutionResult {
  if (input.storageKind !== ProjectStorageKind.Database) {
    return genericToolError(
      ToolName.SpawnAgent,
      ToolExecutionErrorCode.Unsupported,
      "Background Child Agents currently support only Database repositories.",
    );
  }
  try {
    const agentId = stage(runtime.prepareSpawn({
      caller: input.caller,
      profileId: args.profile,
      input: { message: args.message, locale: input.locale },
    }));
    return {
      status: "ok",
      tool: ToolName.SpawnAgent,
      agentId,
      taskStatus: SubagentTaskStatus.Running,
    };
  } catch (error) {
    return runtimeErrorResult(ToolName.SpawnAgent, error);
  }
}

async function waitAgent(
  input: SubagentControlBinding,
  args: Parameters<SubagentToolControl["wait"]>[0],
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  try {
    const result = await runtime.wait(input.caller, args.target, signal);
    if (result.status === SubagentTaskStatus.Completed) {
      return {
        status: "ok",
        tool: ToolName.WaitAgent,
        agentId: result.taskId,
        taskStatus: result.status,
        output: result.result,
      };
    }
    if (result.status === SubagentTaskStatus.Failed) {
      return {
        status: "ok",
        tool: ToolName.WaitAgent,
        agentId: result.taskId,
        taskStatus: result.status,
        error: errorMessage(result.error),
      };
    }
    return {
      status: "ok",
      tool: ToolName.WaitAgent,
      agentId: result.taskId,
      taskStatus: result.status,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return runtimeErrorResult(ToolName.WaitAgent, error);
  }
}

function deliverMessage(
  input: SubagentControlBinding,
  tool: typeof ToolName.SendMessage | typeof ToolName.FollowupTask,
  args: Parameters<SubagentToolControl["sendMessage"]>[0],
  stage: StageAgentTaskAction,
): ToolExecutionResult {
  try {
    if (tool === ToolName.SendMessage) {
      stage(runtime.prepareSendMessage(
        input.caller,
        args.target,
        args.message,
      ));
    } else {
      stage(runtime.prepareFollowupTask(
        input.caller,
        args.target,
        args.message,
      ));
    }
    return { status: "ok", tool, agentId: args.target, accepted: true };
  } catch (error) {
    return runtimeErrorResult(tool, error);
  }
}

function interruptAgent(
  input: SubagentControlBinding,
  args: Parameters<SubagentToolControl["interrupt"]>[0],
  stage: StageAgentTaskAction,
): ToolExecutionResult {
  try {
    const previousTaskStatus = runtime.snapshot(
      input.caller,
      args.target,
    ).status;
    const result = stage(runtime.prepareInterrupt(input.caller, args.target));
    return {
      status: "ok",
      tool: ToolName.InterruptAgent,
      agentId: args.target,
      previousTaskStatus,
      currentTaskStatus: result.status,
    };
  } catch (error) {
    return runtimeErrorResult(ToolName.InterruptAgent, error);
  }
}

export function prepareSubagentToolExecution(
  input: SubagentControlBinding,
): SubagentToolExecution {
  let action: PreparedAgentTaskAction<unknown> | null = null;
  let pendingSpawnActivity: PendingSpawnActivity | null = null;
  let finalized = false;
  const stage: StageAgentTaskAction = (nextAction) => {
    if (finalized || action) {
      nextAction.rollback();
      throw new Error("A tool invocation may stage only one Sub-agent action.");
    }
    action = nextAction;
    return nextAction.result;
  };
  const control: SubagentToolControl = {
    spawn(args) {
      const result = spawnAgent(input, args, stage);
      if (result.status === "ok" && result.tool === ToolName.SpawnAgent) {
        pendingSpawnActivity = {
          agentId: result.agentId,
          profileId: args.profile,
          task: args.message,
        };
      }
      return result;
    },
    async wait(args, signal) {
      return waitAgent(input, args, signal);
    },
    sendMessage(args) {
      return deliverMessage(input, ToolName.SendMessage, args, stage);
    },
    followupTask(args) {
      return deliverMessage(input, ToolName.FollowupTask, args, stage);
    },
    interrupt(args) {
      return interruptAgent(input, args, stage);
    },
  };

  const finalize = (method: "commit" | "rollback") => {
    if (finalized) return;
    finalized = true;
    action?.[method]();
    if (method === "commit" && pendingSpawnActivity) {
      installActivitySubscription(input, {
        kind: SubagentActivityKind.Started,
        ...pendingSpawnActivity,
      });
    }
  };
  return {
    control,
    commit: () => finalize("commit"),
    rollback: () => finalize("rollback"),
  };
}
