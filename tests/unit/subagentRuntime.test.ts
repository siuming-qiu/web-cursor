import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";

const llmCreate = vi.hoisted(() => vi.fn());
const executeToolCall = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("../../server/llm", () => ({
  default: {
    chat: {
      completions: {
        create: llmCreate,
      },
    },
  },
}));
vi.mock("../../server/tools/executor", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../server/tools/executor")>(),
  executeToolCall,
}));

import { resolveSubagentProfile } from "../../server/agentProfiles";
import { prepareSubagentToolExecution, subscribeExistingSubagentActivity } from "../../server/subagentRuntime";
import { ProjectStorageKind } from "../../types/projectStorage";
import {
  SubagentActivityKind,
  SubagentFailureCode,
  SubagentProfileId,
  SubagentTaskStatus,
  SubagentToolStatus,
  type SubagentActivity,
} from "../../types/subagent";
import { ToolName } from "../../types/tool";

const usage = {
  prompt_tokens: 10,
  completion_tokens: 2,
  total_tokens: 12,
};

const caller = {
  taskId: "11111111-1111-4111-8111-111111111111",
  rootTaskId: "11111111-1111-4111-8111-111111111111",
  ownerId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  depth: 0,
} as const;

beforeEach(() => {
  llmCreate.mockReset();
  executeToolCall.mockReset();
});

describe("Explorer Child runtime budget", () => {
  it("injects one convergence instruction at the soft limit and still completes", async () => {
    const requestMessages: Array<readonly { content?: unknown }[]> = [];
    let modelRound = 0;
    llmCreate.mockImplementation(async (...args) => {
      const params = args[0] as { messages: readonly { content?: unknown }[] };
      requestMessages.push(params.messages.map((message) => ({ ...message })));
      modelRound += 1;
      if (modelRound <= 25) {
        return streamOf([toolChunk(modelRound)]);
      }
      return streamOf([chunk({ content: "investigation complete" }, "stop")]);
    });
    executeToolCall.mockResolvedValue({
      status: "ok",
      tool: ToolName.ListFiles,
      files: [],
    });

    const spawnExecution = prepareSubagentToolExecution({
      caller,
      locale: "zh",
      storageKind: ProjectStorageKind.Database,
    });
    const spawnResult = spawnExecution.control.spawn({
      profile: SubagentProfileId.Explorer,
      message: "Inspect the project architecture",
    });
    expect(spawnResult.status).toBe("ok");
    expect(spawnResult.tool).toBe(ToolName.SpawnAgent);
    if (spawnResult.status !== "ok" || spawnResult.tool !== ToolName.SpawnAgent) {
      throw new Error("Expected spawn_agent to return an agent id.");
    }
    spawnExecution.commit();

    const waitExecution = prepareSubagentToolExecution({
      caller,
      locale: "zh",
      storageKind: ProjectStorageKind.Database,
    });
    const waitResult = await waitExecution.control.wait({
      target: spawnResult.agentId,
    });

    expect(waitResult).toMatchObject({
      status: "ok",
      tool: ToolName.WaitAgent,
      agentId: spawnResult.agentId,
      taskStatus: SubagentTaskStatus.Completed,
      output: "investigation complete",
    });
    expect(llmCreate).toHaveBeenCalledTimes(26);

    const profile = resolveSubagentProfile({
      profileId: SubagentProfileId.Explorer,
      locale: "zh",
      storageKind: ProjectStorageKind.Database,
    });
    expect(convergenceMessageCount(requestMessages[23], profile.runtimeBudget.convergenceMessage))
      .toBe(0);
    expect(convergenceMessageCount(requestMessages[24], profile.runtimeBudget.convergenceMessage))
      .toBe(1);
    expect(convergenceMessageCount(requestMessages[25], profile.runtimeBudget.convergenceMessage))
      .toBe(1);
  });
});

describe("Explorer Child activity projection", () => {
  it("publishes started after commit before queued progress and unsubscribes at terminal state", async () => {
    let modelRound = 0;
    llmCreate.mockImplementation(async () => {
      modelRound += 1;
      return modelRound === 1
        ? streamOf([toolChunk(modelRound)])
        : streamOf([chunk({ content: "investigation complete" }, "stop")]);
    });
    executeToolCall.mockResolvedValue({
      status: "ok",
      tool: ToolName.ListFiles,
      files: [],
    });
    const activities: SubagentActivity[] = [];
    const releaseSubscription = vi.fn();
    const registerActivitySubscription = vi.fn((
      _agentId: string,
      unsubscribe: () => void,
    ) => {
      return () => {
        releaseSubscription();
        unsubscribe();
      };
    });

    const spawnExecution = prepareSubagentToolExecution({
      caller,
      locale: "zh",
      storageKind: ProjectStorageKind.Database,
      activitySink: (activity) => activities.push(activity),
      registerActivitySubscription,
    });
    const spawnResult = spawnExecution.control.spawn({
      profile: SubagentProfileId.Explorer,
      message: "Inspect the project architecture",
    });
    if (spawnResult.status !== "ok" || spawnResult.tool !== ToolName.SpawnAgent) {
      throw new Error("Expected spawn_agent to return an agent id.");
    }

    expect(activities).toEqual([]);
    spawnExecution.commit();
    expect(activities).toEqual([{
      kind: SubagentActivityKind.Started,
      agentId: spawnResult.agentId,
      profileId: SubagentProfileId.Explorer,
      task: "Inspect the project architecture",
    }]);
    expect(registerActivitySubscription).toHaveBeenCalledOnce();

    const waitExecution = prepareSubagentToolExecution({
      caller,
      locale: "zh",
      storageKind: ProjectStorageKind.Database,
    });
    const waitResult = await waitExecution.control.wait({
      target: spawnResult.agentId,
    });

    expect(waitResult).toMatchObject({
      status: "ok",
      tool: ToolName.WaitAgent,
      taskStatus: SubagentTaskStatus.Completed,
    });
    expect(activities).toEqual([
      {
        kind: SubagentActivityKind.Started,
        agentId: spawnResult.agentId,
        profileId: SubagentProfileId.Explorer,
        task: "Inspect the project architecture",
      },
      {
        kind: SubagentActivityKind.ModelStarted,
        agentId: spawnResult.agentId,
        round: 1,
      },
      {
        kind: SubagentActivityKind.ToolStarted,
        agentId: spawnResult.agentId,
        toolCallId: "call-1",
        toolName: ToolName.ListFiles,
      },
      {
        kind: SubagentActivityKind.ToolFinished,
        agentId: spawnResult.agentId,
        toolCallId: "call-1",
        status: SubagentToolStatus.Ok,
      },
      {
        kind: SubagentActivityKind.ModelStarted,
        agentId: spawnResult.agentId,
        round: 2,
      },
      {
        kind: SubagentActivityKind.ModelOutput,
        agentId: spawnResult.agentId,
      },
      {
        kind: SubagentActivityKind.StatusChanged,
        agentId: spawnResult.agentId,
        status: SubagentTaskStatus.Completed,
      },
    ]);
    expect(releaseSubscription).toHaveBeenCalledOnce();
  });

  it("keeps Child execution independent from activity observer failures", async () => {
    llmCreate.mockResolvedValue(
      streamOf([chunk({ content: "investigation complete" }, "stop")]),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spawnExecution = prepareSubagentToolExecution({
      caller,
      locale: "zh",
      storageKind: ProjectStorageKind.Database,
      activitySink() {
        throw new Error("transport closed");
      },
      registerActivitySubscription(_agentId, unsubscribe) {
        return unsubscribe;
      },
    });
    const spawnResult = spawnExecution.control.spawn({
      profile: SubagentProfileId.Explorer,
      message: "Inspect the project architecture",
    });
    if (spawnResult.status !== "ok" || spawnResult.tool !== ToolName.SpawnAgent) {
      throw new Error("Expected spawn_agent to return an agent id.");
    }

    expect(() => spawnExecution.commit()).not.toThrow();
    const waitExecution = prepareSubagentToolExecution({
      caller,
      locale: "zh",
      storageKind: ProjectStorageKind.Database,
    });
    const waitResult = await waitExecution.control.wait({
      target: spawnResult.agentId,
    });

    expect(waitResult).toMatchObject({
      status: "ok",
      tool: ToolName.WaitAgent,
      taskStatus: SubagentTaskStatus.Completed,
      output: "investigation complete",
    });
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("does not announce or execute a tool before its streamed arguments validate", async () => {
    let releaseArguments!: () => void;
    const argumentsReady = new Promise<void>((resolve) => { releaseArguments = resolve; });
    let observedName!: () => void;
    const nameReady = new Promise<void>((resolve) => { observedName = resolve; });
    llmCreate.mockResolvedValueOnce((async function* () {
      yield chunk({ tool_calls: [{
        index: 0, id: "invalid-read", type: "function",
        function: { name: ToolName.ReadFile, arguments: "" },
      }] }, null);
      observedName();
      await argumentsReady;
      yield chunk({ tool_calls: [{
        index: 0, function: { arguments: JSON.stringify({ guessedPath: "src/App.tsx" }) },
      }] }, "tool_calls");
    })());
    llmCreate.mockResolvedValueOnce(streamOf([chunk({ content: "Cannot read invalid arguments." }, "stop")]));
    const activities: SubagentActivity[] = [];
    const execution = prepareSubagentToolExecution({
      caller,
      locale: "zh",
      storageKind: ProjectStorageKind.Database,
      activitySink: (activity) => activities.push(activity),
      registerActivitySubscription: (_id, unsubscribe) => unsubscribe,
    });
    const spawn = execution.control.spawn({ profile: SubagentProfileId.Explorer, message: "Inspect files" });
    if (spawn.status !== "ok" || spawn.tool !== ToolName.SpawnAgent) throw new Error("Expected Child id");
    execution.commit();
    await nameReady;
    expect(activities.map((activity) => activity.kind)).toEqual([
      SubagentActivityKind.Started, SubagentActivityKind.ModelStarted,
    ]);
    expect(executeToolCall).not.toHaveBeenCalled();
    releaseArguments();
    await execution.control.wait({ target: spawn.agentId });
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(activities.some((activity) => activity.kind === SubagentActivityKind.ToolStarted)).toBe(false);
  });

  it.each([
    SubagentFailureCode.ModelRequestFailed,
    SubagentFailureCode.ExecutionFailed,
    SubagentFailureCode.MaxModelRounds,
  ])("publishes safe %s diagnostics and replays terminal state without subscribing", async (failureCode) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secret = "provider credential MUST_NOT_REACH_PUBLIC_ACTIVITY";
    if (failureCode === SubagentFailureCode.ModelRequestFailed) {
      llmCreate.mockRejectedValue(new Error(secret));
    } else {
      let round = 0;
      llmCreate.mockImplementation(async () => streamOf([toolChunk(++round)]));
      if (failureCode === SubagentFailureCode.ExecutionFailed) {
        executeToolCall.mockRejectedValue(new Error(secret));
      } else {
        executeToolCall.mockResolvedValue({ status: "ok", tool: ToolName.ListFiles, files: [] });
      }
    }
    const activities: SubagentActivity[] = [];
    const binding = {
      caller,
      locale: "zh" as const,
      storageKind: ProjectStorageKind.Database,
      activitySink: (activity: SubagentActivity) => activities.push(activity),
      registerActivitySubscription: (_id: string, unsubscribe: () => void) => unsubscribe,
    };
    const execution = prepareSubagentToolExecution(binding);
    const spawn = execution.control.spawn({ profile: SubagentProfileId.Explorer, message: "Inspect files" });
    if (spawn.status !== "ok" || spawn.tool !== ToolName.SpawnAgent) throw new Error("Expected Child id");
    execution.commit();
    await execution.control.wait({ target: spawn.agentId });
    expect(activities.at(-1)).toMatchObject({
      kind: SubagentActivityKind.StatusChanged,
      status: SubagentTaskStatus.Failed,
      failure: { code: failureCode },
    });
    const snapshots: SubagentActivity[] = [];
    const register = vi.fn();
    subscribeExistingSubagentActivity({
      ...binding,
      activitySink: (activity) => snapshots.push(activity),
      registerActivitySubscription: register,
    });
    expect(snapshots.find((activity) => activity.agentId === spawn.agentId)).toMatchObject({
      kind: SubagentActivityKind.Snapshot,
      status: SubagentTaskStatus.Failed,
      failure: { code: failureCode },
    });
    expect(register).not.toHaveBeenCalled();
    expect(JSON.stringify([...activities, ...snapshots])).not.toContain(secret);
    warning.mockRestore();
  });

  it("does not reverse a committed spawn when subscription registration fails", async () => {
    llmCreate.mockResolvedValue(
      streamOf([chunk({ content: "investigation complete" }, "stop")]),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const activitySink = vi.fn();
    const spawnExecution = prepareSubagentToolExecution({
      caller,
      locale: "zh",
      storageKind: ProjectStorageKind.Database,
      activitySink,
      registerActivitySubscription() {
        throw new Error("registry closed");
      },
    });
    const spawnResult = spawnExecution.control.spawn({
      profile: SubagentProfileId.Explorer,
      message: "Inspect the project architecture",
    });
    if (spawnResult.status !== "ok" || spawnResult.tool !== ToolName.SpawnAgent) {
      throw new Error("Expected spawn_agent to return an agent id.");
    }

    expect(() => spawnExecution.commit()).not.toThrow();
    const waitExecution = prepareSubagentToolExecution({
      caller,
      locale: "zh",
      storageKind: ProjectStorageKind.Database,
    });
    const waitResult = await waitExecution.control.wait({
      target: spawnResult.agentId,
    });

    expect(waitResult).toMatchObject({
      status: "ok",
      tool: ToolName.WaitAgent,
      taskStatus: SubagentTaskStatus.Completed,
      output: "investigation complete",
    });
    expect(activitySink).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});

function convergenceMessageCount(
  messages: readonly { content?: unknown }[] | undefined,
  message: string,
): number {
  return messages?.filter(({ content }) => content === message).length ?? 0;
}

function toolChunk(round: number): ChatCompletionChunk {
  return chunk({
    tool_calls: [{
      index: 0,
      id: `call-${round}`,
      type: "function",
      function: {
        name: ToolName.ListFiles,
        arguments: "{}",
      },
    }],
  }, "tool_calls");
}

function chunk(
  delta: ChatCompletionChunk.Choice.Delta,
  finishReason: ChatCompletionChunk.Choice["finish_reason"],
): ChatCompletionChunk {
  return {
    id: "chunk-id",
    choices: [{
      delta,
      finish_reason: finishReason,
      index: 0,
      logprobs: null,
    }],
    created: 0,
    model: "test-model",
    object: "chat.completion.chunk",
    usage,
  };
}

async function* streamOf(
  chunks: readonly ChatCompletionChunk[],
): AsyncGenerator<ChatCompletionChunk> {
  for (const item of chunks) yield item;
}
