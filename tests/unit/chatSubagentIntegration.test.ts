/**
 * Integration boundary: only provider I/O and persistence are test doubles.
 * POST, harness restoration, context assembly, both Agent loops, tool dispatch,
 * Child Runtime, activity subscriptions, and SSE bytes are production code.
 * This does not claim to validate PostgreSQL transactions or lease fencing.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";

const boundary = vi.hoisted(() => {
  process.env.DEEPSEEK_API_KEY = "integration-test-placeholder";
  return {
    model: vi.fn(),
    select: vi.fn(),
    acquire: vi.fn(),
    beginRound: vi.fn(),
    recordRound: vi.fn(),
    startTool: vi.fn(),
    recordResult: vi.fn(),
    recordReply: vi.fn(),
    release: vi.fn(),
    heartbeat: vi.fn(),
    fail: vi.fn(),
    transaction: vi.fn(),
    listMessages: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("../../server/db", () => ({ db: { select: boundary.select } }));
vi.mock("../../server/llm", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../server/llm")>(),
  default: { chat: { completions: { create: boundary.model } } },
}));
vi.mock("../../server/agentRuns", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../server/agentRuns")>(),
  acquireAgentRun: boundary.acquire,
  beginAgentModelRound: boundary.beginRound,
  recordAgentToolRound: boundary.recordRound,
  markServerToolInvocationStarted: boundary.startTool,
  recordServerToolResult: boundary.recordResult,
  recordAgentAssistantReply: boundary.recordReply,
  releaseAgentRunLease: boundary.release,
  heartbeatAgentRun: boundary.heartbeat,
  failAgentRun: boundary.fail,
  runInAgentRunTransaction: boundary.transaction,
}));
vi.mock("../../server/messages", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../server/messages")>(),
  listMessages: boundary.listMessages,
}));
vi.mock("../../server/files", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../server/files")>(),
  listProjectFilesSnapshot: boundary.listFiles,
  readProjectFile: boundary.readFile,
}));

import { POST } from "../../app/api/chat/route";
import { agentHarnessFor } from "../../server/agentHarness";
import type {
  AgentRunInvocation,
  AgentRunLease,
  AgentRunTransaction,
} from "../../server/agentRuns";
import { AgentTaskRuntime } from "../../server/agentTaskRuntime";
import { conversations, messages } from "../../server/db/schema";
import { prepareSubagentToolExecution } from "../../server/subagentRuntime";
import {
  AgentRunSnapshotSchema,
  AgentRunStatus,
  AgentRunTrigger,
  type AgentRunSnapshot,
} from "../../types/agentRun";
import { ChatEventSchema, ChatEventType, type ChatEvent } from "../../types/chat";
import { ProjectStorageKind } from "../../types/projectStorage";
import {
  SubagentActivityKind,
  SubagentProfileId,
  SubagentTaskStatus,
  SubagentToolStatus,
  type SubagentActivity,
} from "../../types/subagent";
import { ToolName, ToolResultType, type ToolCallMeta } from "../../types/tool";
import { SpawnAgentResultSchema, ToolInterruptedResultSchema, WaitAgentResultSchema } from "../../types/toolResult";
import {
  LegacyAssistantMessageKind,
  StoredMessageInputSchema,
  StoredMessageRole,
  type StoredMessageInput,
} from "../../types/transcript";

type AgentRunsModule = typeof import("../../server/agentRuns");
type DbMessage = typeof messages.$inferSelect;
const CHILD_TASK = "检查 src/App.tsx 的入口实现";
const CHILD_OUTPUT = "子代理已经读取入口，调查完成。";
const PARENT_OUTPUT = "已收到子代理结论。";
const TIMESTAMP = "2026-08-12T08:00:00.000Z";
const usage = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 };

let fixture: ReturnType<typeof createFixture>;

beforeEach(() => {
  vi.clearAllMocks();
  fixture = createFixture();
  installPersistence(fixture);
  installProvider(fixture);
});

afterEach(async () => {
  fixture.request.abort();
  releaseChildGates(fixture);
  if (fixture.agentId) {
    await childControl(fixture).wait({ target: fixture.agentId });
  }
  vi.restoreAllMocks();
});

describe("real Chat Route → Child Runtime → SSE", () => {
  it("streams live Child progress while Parent waits, then closes the real tool result", async () => {
    const observation = observeRuntime();
    const response = await openChat(fixture);
    const stream = consumeSse(response);
    await expect.poll(() => observation.wait.mock.calls.length).toBe(1);
    await expect.poll(() => activities(stream.events).length).toBeGreaterThan(0);

    const started = activities(stream.events).find(
      (activity) => activity.kind === SubagentActivityKind.Started,
    );
    expect(started).toMatchObject({
      agentId: fixture.agentId,
      profileId: SubagentProfileId.Explorer,
      task: CHILD_TASK,
    });
    expect(boundary.recordResult).toHaveBeenCalledTimes(1);
    expect(observation.releases).toHaveLength(1);
    expect(observation.releases[0]).not.toHaveBeenCalled();

    fixture.allowChild.resolve();
    await fixture.readArgumentsPending.promise;
    expect(activities(stream.events).some((activity) =>
      activity.kind === SubagentActivityKind.ToolStarted && activity.toolCallId === "child-read",
    )).toBe(false);
    expect(boundary.readFile).not.toHaveBeenCalled();
    fixture.allowReadArguments.resolve();
    await fixture.readFileStarted.promise;
    await expect.poll(() => activities(stream.events).some((activity) =>
      activity.kind === SubagentActivityKind.ToolStarted
      && activity.toolCallId === "child-read" && activity.detail === "src/App.tsx",
    )).toBe(true);
    expect(activities(stream.events).some((activity) =>
      activity.kind === SubagentActivityKind.ToolFinished && activity.toolCallId === "child-read",
    )).toBe(false);
    fixture.allowReadResult.resolve();
    await stream.finished;

    const childActivities = activities(stream.events);
    expect(childActivities[0].kind).toBe(SubagentActivityKind.Started);
    expect(childActivities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: SubagentActivityKind.ToolStarted,
        toolCallId: "child-list",
        toolName: ToolName.ListFiles,
      }),
      expect.objectContaining({
        kind: SubagentActivityKind.ToolStarted,
        toolCallId: "child-read",
        toolName: ToolName.ReadFile,
        detail: "src/App.tsx",
      }),
      expect.objectContaining({ kind: SubagentActivityKind.ModelStarted, round: 1 }),
      expect.objectContaining({ kind: SubagentActivityKind.ToolFinished, toolCallId: "child-read", status: SubagentToolStatus.Ok }),
      expect.objectContaining({ kind: SubagentActivityKind.ModelOutput }),
      expect.objectContaining({
        kind: SubagentActivityKind.StatusChanged,
        status: SubagentTaskStatus.Completed,
      }),
    ]));
    expect(childActivities.every((activity) => activity.agentId === fixture.agentId)).toBe(true);
    expect(childActivities.filter((activity) => activity.kind === SubagentActivityKind.ModelStarted)
      .map((activity) => activity.round)).toEqual([1, 2, 3]);
    expect(childActivities.filter((activity) => activity.kind === SubagentActivityKind.ModelOutput)).toHaveLength(1);
    expect(childActivities.filter((activity) => activity.kind === SubagentActivityKind.ToolFinished)
      .map((activity) => activity.toolCallId)).toEqual(["child-list", "child-read"]);
    expect(stream.events.every((event) =>
      event.agentRunId === fixture.run.id && event.attempt === fixture.run.attempt,
    )).toBe(true);
    expect(stream.events.filter((event) => event.type === ChatEventType.Error)).toEqual([]);
    expect(stream.events.filter((event) => event.type === ChatEventType.Chat))
      .toEqual([{ type: ChatEventType.Chat, agentRunId: fixture.run.id, attempt: fixture.run.attempt, delta: PARENT_OUTPUT }]);
    const terminalIndex = stream.events.findIndex((event) =>
      event.type === ChatEventType.SubagentActivity
      && event.activity.kind === SubagentActivityKind.StatusChanged
      && event.activity.status === SubagentTaskStatus.Completed,
    );
    const waitResultIndex = stream.events.findIndex((event) =>
      event.type === ChatEventType.ToolResult && event.name === ToolName.WaitAgent,
    );
    expect(terminalIndex).toBeGreaterThan(-1);
    expect(waitResultIndex).toBeGreaterThan(terminalIndex);
    expect(stream.events.at(-1)?.type).toBe(ChatEventType.Done);
    expect(boundary.listFiles).toHaveBeenCalledWith(fixture.run.projectId);
    expect(boundary.readFile).toHaveBeenCalledWith(fixture.run.projectId, "src/App.tsx");
    expect(WaitAgentResultSchema.parse(fixture.results.get("parent-wait"))).toMatchObject({
      taskStatus: SubagentTaskStatus.Completed,
      output: CHILD_OUTPUT,
    });
    expect(observation.releases[0]).toHaveBeenCalledTimes(1);
    expect(boundary.release).toHaveBeenCalledTimes(1);
    expect(boundary.fail).not.toHaveBeenCalled();
  });

  it.each(["request abort", "reader cancel"] as const)(
    "%s releases the activity subscription without aborting the Child",
    async (disconnect) => {
      const observation = observeRuntime();
      const response = await openChat(fixture);
      const stream = consumeSse(response);
      await expect.poll(() => observation.wait.mock.calls.length).toBe(1);
      await expect.poll(() => activities(stream.events).length).toBeGreaterThan(0);
      expect(fixture.childSignals).toHaveLength(1);

      if (disconnect === "request abort") fixture.request.abort();
      else await stream.reader.cancel();
      await stream.finished;
      await expect.poll(() => boundary.release.mock.calls.length).toBe(1);

      expect(observation.releases).toHaveLength(1);
      expect(observation.releases[0]).toHaveBeenCalledTimes(1);
      expect(fixture.childSignals[0].aborted).toBe(false);
      expect(boundary.fail).not.toHaveBeenCalled();
      expect(ToolInterruptedResultSchema.parse(fixture.results.get("parent-wait"))).toMatchObject({
        type: ToolResultType.ToolInterrupted,
      });
      expect(boundary.recordResult).toHaveBeenCalledTimes(1);
      const closedEventCount = stream.events.length;

      releaseChildGates(fixture);
      const completion = await childControl(fixture).wait({ target: requireAgentId(fixture) });
      expect(completion).toMatchObject({
        status: "ok",
        tool: ToolName.WaitAgent,
        taskStatus: SubagentTaskStatus.Completed,
        output: CHILD_OUTPUT,
      });
      expect(fixture.childSignals.every((signal) => !signal.aborted)).toBe(true);
      expect(boundary.readFile).toHaveBeenCalledOnce();
      expect(stream.events).toHaveLength(closedEventCount);
      expect(observation.releases[0]).toHaveBeenCalledTimes(1);
      expect(boundary.recordResult).toHaveBeenCalledTimes(1);
      expect(boundary.recordReply).not.toHaveBeenCalled();
    },
  );

  it("resumes the same Parent with a real Child snapshot and exactly one new subscription", async () => {
    const observation = observeRuntime();
    const originalStream = consumeSse(await openChat(fixture));
    await expect.poll(() => observation.wait.mock.calls.length).toBe(1);
    fixture.allowChild.resolve();
    await fixture.readArgumentsPending.promise;
    fixture.request.abort();
    await originalStream.finished;
    expect(fixture.run.status).toBe(AgentRunStatus.WaitingResume);
    const disconnectedCount = originalStream.events.length;
    const previousAttempt = fixture.run.attempt;

    fixture.request = new AbortController();
    const resumedStream = consumeSse(await openChat(fixture));
    await expect.poll(() => observation.wait.mock.calls.length).toBe(2);
    await expect.poll(() => activities(resumedStream.events).length).toBeGreaterThan(0);
    const resumedActivities = activities(resumedStream.events);
    expect(resumedActivities).toEqual([{
      kind: SubagentActivityKind.Snapshot,
      agentId: requireAgentId(fixture),
      profileId: SubagentProfileId.Explorer,
      task: CHILD_TASK,
      status: SubagentTaskStatus.Running,
      progress: [
        { kind: SubagentActivityKind.ModelStarted, round: 1 },
        { kind: SubagentActivityKind.ToolStarted, toolCallId: "child-list", toolName: ToolName.ListFiles },
        { kind: SubagentActivityKind.ToolFinished, toolCallId: "child-list", status: SubagentToolStatus.Ok },
        { kind: SubagentActivityKind.ModelStarted, round: 2 },
      ],
    }]);
    expect(fixture.run.attempt).toBe(previousAttempt + 1);
    expect(observation.releases).toHaveLength(2);
    expect(observation.releases[0]).toHaveBeenCalledTimes(1);
    expect(observation.releases[1]).not.toHaveBeenCalled();

    releaseChildGates(fixture);
    await resumedStream.finished;
    expect(activities(resumedStream.events).filter((activity) =>
      activity.kind === SubagentActivityKind.StatusChanged,
    )).toEqual([{
      kind: SubagentActivityKind.StatusChanged,
      agentId: requireAgentId(fixture),
      status: SubagentTaskStatus.Completed,
    }]);
    expect(resumedStream.events.every((event) => event.attempt === fixture.run.attempt)).toBe(true);
    expect(resumedStream.events.filter((event) => event.type === ChatEventType.Error)).toEqual([]);
    expect(WaitAgentResultSchema.parse(fixture.results.get("parent-resumed-wait"))).toMatchObject({
      taskStatus: SubagentTaskStatus.Completed, output: CHILD_OUTPUT,
    });
    expect(originalStream.events).toHaveLength(disconnectedCount);
    expect(observation.releases).toHaveLength(2);
    expect(observation.releases[1]).toHaveBeenCalledTimes(1);
    expect(boundary.release).toHaveBeenCalledTimes(2);
    expect(boundary.fail).not.toHaveBeenCalled();
  });
});

function createFixture() {
  const projectId = randomUUID();
  const run: AgentRunSnapshot = AgentRunSnapshotSchema.parse({
    id: randomUUID(),
    projectId,
    conversationId: randomUUID(),
    requestId: randomUUID(),
    trigger: AgentRunTrigger.User,
    status: AgentRunStatus.WaitingResume,
    attempt: 1,
    modelRounds: 0,
    toolRounds: 0,
    maxModelRounds: 24,
    maxToolRounds: 24,
    repository: { projectId, storageKind: ProjectStorageKind.Database, revision: 0 },
    failure: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    startedAt: TIMESTAMP,
    cancelRequestedAt: null,
    completedAt: null,
  });
  return {
    run,
    ownerId: randomUUID(),
    leaseId: randomUUID(),
    agentId: null as string | null,
    rows: [] as DbMessage[],
    invocations: new Map<string, AgentRunInvocation>(),
    startedInvocations: new Set<string>(),
    results: new Map<string, unknown>(),
    childSignals: [] as AbortSignal[],
    allowChild: deferred(),
    readArgumentsPending: deferred(),
    allowReadArguments: deferred(),
    readFileStarted: deferred(),
    allowReadResult: deferred(),
    request: new AbortController(),
  };
}

function installPersistence(state: ReturnType<typeof createFixture>) {
  appendMessage(state, { role: StoredMessageRole.User, content: "请通过子代理调查入口" });
  boundary.acquire.mockImplementation(async (input: Parameters<AgentRunsModule["acquireAgentRun"]>[0]) => {
    expect(input).toEqual({
      ownerId: state.ownerId,
      runId: state.run.id,
      conversationId: state.run.conversationId,
      expectedAttempt: state.run.attempt,
      allowedStatuses: [AgentRunStatus.WaitingResume, AgentRunStatus.WaitingExternal],
    });
    expect(input.allowedStatuses).toContain(state.run.status);
    state.run.status = AgentRunStatus.Running;
    state.run.attempt += 1;
    state.leaseId = randomUUID();
    return {
      run: state.run,
      leaseId: state.leaseId,
      harnessIdentity: agentHarnessFor("zh", ProjectStorageKind.Database).identity,
    } satisfies AgentRunLease;
  });
  boundary.select.mockImplementation((selection: unknown) => {
    expect(selection).toEqual({
      contextSummary: conversations.contextSummary,
      contextSummaryThroughSeq: conversations.contextSummaryThroughSeq,
    });
    return { from(table: unknown) {
      expect(table).toBe(conversations);
      return { where() { return { async limit(count: number) {
        expect(count).toBe(1);
        return [{ contextSummary: null, contextSummaryThroughSeq: null }];
      } }; } };
    } };
  });
  boundary.listMessages.mockImplementation(async (conversationId: string) => {
    expect(conversationId).toBe(state.run.conversationId);
    return [...state.rows];
  });
  boundary.beginRound.mockImplementation(async () => ++state.run.modelRounds);
  boundary.recordRound.mockImplementation(async (input: Parameters<AgentRunsModule["recordAgentToolRound"]>[0]) => {
    appendMessage(state, {
      role: StoredMessageRole.Assistant,
      content: input.assistantText,
      model: input.model,
      meta: { toolCalls: input.invocations.map(({ toolCall }) => toolCall) },
    });
    state.run.toolRounds += 1;
    return input.invocations.map(({ toolCall, callIndex, executionDomain, effect }) => {
      const invocation: AgentRunInvocation = {
        id: randomUUID(), agentRunId: input.runId, attempt: input.attempt,
        modelRound: input.modelRound, callIndex, providerCallId: toolCall.id,
        toolName: toolCall.name, arguments: toolCall.arguments, executionDomain, effect,
      };
      state.invocations.set(invocation.id, invocation);
      return invocation;
    });
  });
  boundary.startTool.mockImplementation(async (input: Parameters<AgentRunsModule["markServerToolInvocationStarted"]>[0]) => {
    requireInvocation(state, input.invocationId);
    state.startedInvocations.add(input.invocationId);
  });
  boundary.recordResult.mockImplementation(async (input: Parameters<AgentRunsModule["recordServerToolResult"]>[0]) => {
    const invocation = requireInvocation(state, input.invocationId);
    expect(state.startedInvocations.has(invocation.id)).toBe(true);
    const result: unknown = JSON.parse(input.content);
    state.results.set(invocation.providerCallId, result);
    if (invocation.toolName === ToolName.SpawnAgent) {
      state.agentId = SpawnAgentResultSchema.parse(result).agentId;
    }
    appendMessage(state, {
      role: StoredMessageRole.Tool, content: input.content,
      meta: { toolCallId: invocation.providerCallId },
    });
  });
  boundary.recordReply.mockImplementation(async (input: Parameters<AgentRunsModule["recordAgentAssistantReply"]>[0]) => {
    appendMessage(state, {
      role: StoredMessageRole.Assistant, content: input.content, model: input.model,
      meta: { kind: LegacyAssistantMessageKind.Reply },
    });
    state.run.status = AgentRunStatus.WaitingFeedback;
    return { ...state.run };
  });
  boundary.transaction.mockImplementation(async (operation: (writer: AgentRunTransaction) => Promise<unknown>) =>
    operation({} as AgentRunTransaction),
  );
  boundary.heartbeat.mockResolvedValue(undefined);
  boundary.release.mockImplementation(async () => {
    if (state.run.status !== AgentRunStatus.Running) return { ...state.run };
    // Explicit persistence-double rule from agentRuns.releaseAgentRunLease /
    // reconcileRecoverableRun: an unfinished read closes as TOOL_INTERRUPTED.
    for (const invocation of state.invocations.values()) {
      if (state.results.has(invocation.providerCallId)) continue;
      if (invocation.toolName !== ToolName.WaitAgent) throw new Error("Fixture only supports recovering wait_agent");
      const result = ToolInterruptedResultSchema.parse({
        status: "error", type: ToolResultType.ToolInterrupted,
        message: "Previous execution ended before returning a durable tool result.",
      });
      state.results.set(invocation.providerCallId, result);
      appendMessage(state, {
        role: StoredMessageRole.Tool, content: JSON.stringify(result),
        meta: { toolCallId: invocation.providerCallId },
      });
    }
    state.run.status = AgentRunStatus.WaitingResume;
    return { ...state.run };
  });
  boundary.fail.mockImplementation(async (input: Parameters<AgentRunsModule["failAgentRun"]>[0]) => ({
    ...state.run, status: AgentRunStatus.Failed, failure: { code: input.code, message: input.message },
  }));
  boundary.listFiles.mockResolvedValue({ revision: 0, files: [{ path: "src/App.tsx", updatedAt: TIMESTAMP }] });
  boundary.readFile.mockImplementation(async () => {
    state.readFileStarted.resolve();
    await state.allowReadResult.promise;
    return { revision: 0, path: "src/App.tsx", content: "export default function App() { return null; }", updatedAt: TIMESTAMP };
  });
}

function installProvider(state: ReturnType<typeof createFixture>) {
  let childRound = 0;
  boundary.model.mockImplementation(async (
    params: ChatCompletionCreateParamsStreaming,
    options: { signal: AbortSignal },
  ) => {
    const isParent = params.tools?.some((tool) =>
      tool.type === "function" && tool.function.name === ToolName.SpawnAgent,
    );
    if (isParent) {
      const lastResult = params.messages.filter((entry) => entry.role === StoredMessageRole.Tool).at(-1);
      if (!lastResult) return streamOf([toolChunk({
        id: "parent-spawn", name: ToolName.SpawnAgent,
        arguments: JSON.stringify({ profile: SubagentProfileId.Explorer, message: CHILD_TASK }),
      })]);
      if (typeof lastResult.content !== "string") throw new Error("Parent tool result must be serialized JSON");
      if (lastResult.tool_call_id === "parent-spawn") {
        const spawn = SpawnAgentResultSchema.parse(JSON.parse(lastResult.content));
        return streamOf([toolChunk({
          id: "parent-wait", name: ToolName.WaitAgent,
          arguments: JSON.stringify({ target: spawn.agentId }),
        })]);
      }
      if (lastResult.tool_call_id === "parent-wait"
        && ToolInterruptedResultSchema.safeParse(JSON.parse(lastResult.content)).success) {
        const spawnMessage = params.messages.find((entry) =>
          entry.role === StoredMessageRole.Tool && entry.tool_call_id === "parent-spawn",
        );
        if (!spawnMessage || typeof spawnMessage.content !== "string") throw new Error("Resume lost the committed spawn result");
        const spawn = SpawnAgentResultSchema.parse(JSON.parse(spawnMessage.content));
        return streamOf([toolChunk({
          id: "parent-resumed-wait", name: ToolName.WaitAgent,
          arguments: JSON.stringify({ target: spawn.agentId }),
        })]);
      }
      const completion = WaitAgentResultSchema.parse(JSON.parse(lastResult.content));
      expect(completion.taskStatus).toBe(SubagentTaskStatus.Completed);
      return streamOf([chunk({ content: PARENT_OUTPUT }, "stop")]);
    }
    state.childSignals.push(options.signal);
    childRound += 1;
    if (childRound === 1) {
      await state.allowChild.promise;
      return streamOf([toolChunk({ id: "child-list", name: ToolName.ListFiles, arguments: "{}" })]);
    }
    if (childRound === 2) return fragmentedReadCall(state);
    if (childRound === 3) return streamOf([
      chunk({ content: CHILD_OUTPUT.slice(0, 7) }, null),
      chunk({ content: CHILD_OUTPUT.slice(7) }, "stop"),
    ]);
    throw new Error(`Unexpected Child model round: ${childRound}`);
  });
}

async function openChat(state: ReturnType<typeof createFixture>) {
  const response = await POST(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-owner-id": state.ownerId },
    body: JSON.stringify({ kind: "resume", runId: state.run.id, conversationId: state.run.conversationId, attempt: state.run.attempt }),
    signal: state.request.signal,
  }));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
  return response;
}

function consumeSse(response: Response) {
  if (!response.body) throw new Error("Chat response has no SSE body");
  const reader = response.body.getReader();
  const events: ChatEvent[] = [];
  const finished = (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop()!;
      for (const block of blocks) {
        if (!block.startsWith("data: ")) throw new Error(`Unexpected SSE block: ${block}`);
        events.push(ChatEventSchema.parse(JSON.parse(block.slice(6))));
      }
    }
    expect(buffer + decoder.decode()).toBe("");
  })();
  return { reader, events, finished };
}

function observeRuntime() {
  const original = AgentTaskRuntime.prototype.subscribe;
  const releases: ReturnType<typeof vi.fn>[] = [];
  vi.spyOn(AgentTaskRuntime.prototype, "subscribe").mockImplementation(function (
    this: AgentTaskRuntime<unknown, unknown, unknown, unknown>, ...args
  ) {
    const release = vi.fn(original.apply(this, args));
    releases.push(release);
    return release;
  });
  return { wait: vi.spyOn(AgentTaskRuntime.prototype, "wait"), releases };
}

function activities(events: ChatEvent[]): SubagentActivity[] {
  return events.flatMap((event) => event.type === ChatEventType.SubagentActivity ? [event.activity] : []);
}

function appendMessage(state: ReturnType<typeof createFixture>, input: StoredMessageInput) {
  const message = StoredMessageInputSchema.parse(input);
  state.rows.push({
    id: randomUUID(), conversationId: state.run.conversationId, agentRunId: state.run.id,
    seq: state.rows.length + 1, role: message.role, content: message.content,
    model: "model" in message ? message.model : null, meta: message.meta ?? null,
    createdAt: new Date(TIMESTAMP), deletedAt: null,
  });
}

function requireInvocation(state: ReturnType<typeof createFixture>, id: string) {
  const invocation = state.invocations.get(id);
  if (!invocation) throw new Error(`Unknown fixture invocation: ${id}`);
  return invocation;
}

function requireAgentId(state: ReturnType<typeof createFixture>) {
  if (!state.agentId) throw new Error("Expected a committed spawn result");
  return state.agentId;
}

function childControl(state: ReturnType<typeof createFixture>) {
  return prepareSubagentToolExecution({
    caller: { taskId: state.run.id, rootTaskId: state.run.id, ownerId: state.ownerId, projectId: state.run.projectId, depth: 0 },
    locale: "zh", storageKind: ProjectStorageKind.Database,
  }).control;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function releaseChildGates(state: ReturnType<typeof createFixture>) {
  state.allowChild.resolve();
  state.allowReadArguments.resolve();
  state.allowReadResult.resolve();
}

async function* fragmentedReadCall(state: ReturnType<typeof createFixture>) {
  yield chunk({ tool_calls: [{
    index: 0, id: "child-read", type: "function",
    function: { name: ToolName.ReadFile, arguments: '{"path":"src/' },
  }] }, null);
  state.readArgumentsPending.resolve();
  await state.allowReadArguments.promise;
  yield chunk({ tool_calls: [{ index: 0, function: { arguments: 'App.tsx"}' } }] }, "tool_calls");
}

function toolChunk(call: ToolCallMeta): ChatCompletionChunk {
  return chunk({ tool_calls: [{
    index: 0, id: call.id, type: "function",
    function: { name: call.name, arguments: call.arguments },
  }] }, "tool_calls");
}

function chunk(
  delta: ChatCompletionChunk.Choice.Delta,
  finishReason: ChatCompletionChunk.Choice["finish_reason"],
): ChatCompletionChunk {
  return {
    id: "provider-chunk", object: "chat.completion.chunk", created: 0, model: "integration-provider",
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }], usage,
  };
}

async function* streamOf(chunks: readonly ChatCompletionChunk[]) {
  yield* chunks;
}
