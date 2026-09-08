import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";

const llmCreate = vi.hoisted(() => vi.fn());

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

import {
  AgentLoopControl,
  AgentLoopLimitError,
  runAgentLoop,
  type AgentLoopHost,
  type AgentModelHarness,
  type AgentModelObserver,
} from "../../server/agentRunner";
import { AgentToolExecutionDomain } from "../../types/agentRun";
import type { ToolCallMeta } from "../../types/tool";

type TestInvocation = Readonly<{
  executionDomain: typeof AgentToolExecutionDomain[
    keyof typeof AgentToolExecutionDomain
  ];
  call: ToolCallMeta;
}>;

const harness: AgentModelHarness = {
  model: "deepseek-v4-pro",
  tools: [],
  toolChoice: "auto",
  stream: true,
  thinking: { type: "disabled" },
};

const usage = {
  prompt_tokens: 10,
  completion_tokens: 2,
  total_tokens: 12,
};

beforeEach(() => {
  llmCreate.mockReset();
});

describe("runAgentLoop", () => {
  it("records a text-only reply once and obeys the Host stop boundary", async () => {
    llmCreate.mockResolvedValueOnce(streamOf([
      chunk({ content: "final answer" }, "stop", usage),
    ]));
    const calls: string[] = [];
    const observer = observerRecording(calls);
    const host = hostFor({
      calls,
      recordAssistantReply: async (text) => {
        calls.push(`reply:${text}`);
        return AgentLoopControl.Stop;
      },
    });

    await runAgentLoop({
      harness,
      host,
      observer,
      signal: new AbortController().signal,
    });

    expect(calls).toEqual([
      "prepare",
      "begin:1",
      "request",
      "text:final answer",
      "reply:final answer",
    ]);
    expect(host.recordToolRound).not.toHaveBeenCalled();
    expect(llmCreate).toHaveBeenCalledTimes(1);
  });

  it("orders baseline before execution, closes every mixed-domain call, then continues", async () => {
    llmCreate
      .mockResolvedValueOnce(streamOf([
        toolChunk([{ id: "call-read", name: "list_files", arguments: "{}" }]),
      ]))
      .mockResolvedValueOnce(streamOf([
        toolChunk([
          { id: "call-server", name: "read_file", arguments: "{\"path\":\"src/App.tsx\"}" },
          { id: "call-client", name: "run_preview", arguments: "{}" },
        ]),
      ]))
      .mockResolvedValueOnce(streamOf([
        chunk({ content: "done" }, "stop", usage),
      ]));

    const calls: string[] = [];
    let round = 0;
    const rejected: (readonly TestInvocation[])[] = [];
    const host = hostFor({
      calls,
      recordToolRound: async ({ modelRound, toolCalls }) => {
        calls.push(`record:${modelRound}:${toolCalls.length}`);
        if (modelRound === 1) {
          return toolCalls.map((call) => ({
            executionDomain: AgentToolExecutionDomain.Server,
            call,
          }));
        }
        return toolCalls.map((call, index) => ({
          executionDomain: index === 0
            ? AgentToolExecutionDomain.Server
            : AgentToolExecutionDomain.Client,
          call,
        }));
      },
      updateContextBaseline: async () => {
        calls.push("baseline");
      },
      executeToolRound: async ({ invocations }) => {
        calls.push(`execute:${invocations.length}`);
        return AgentLoopControl.Continue;
      },
      rejectInvalidToolRound: async ({ invocations }) => {
        rejected.push(invocations);
        calls.push(`reject:${invocations.length}`);
      },
      recordAssistantReply: async (text) => {
        calls.push(`reply:${text}`);
        return AgentLoopControl.Stop;
      },
      beginModelRound: async () => {
        round += 1;
        calls.push(`begin:${round}`);
        return round;
      },
    });

    await runAgentLoop({
      harness,
      host,
      observer: observerRecording(calls),
      signal: new AbortController().signal,
    });

    expect(calls).toEqual([
      "prepare",
      "begin:1",
      "request",
      "tool:call-read:list_files",
      "record:1:1",
      "baseline",
      "execute:1",
      "prepare",
      "begin:2",
      "request",
      "tool:call-server:read_file",
      "tool:call-client:run_preview",
      "record:2:2",
      "baseline",
      "reject:2",
      "prepare",
      "begin:3",
      "request",
      "text:done",
      "reply:done",
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].map(({ call }) => call.id)).toEqual([
      "call-server",
      "call-client",
    ]);
    expect(llmCreate).toHaveBeenCalledTimes(3);
  });

  it("fails before another provider call when the configured model-round limit is exhausted", async () => {
    llmCreate.mockResolvedValueOnce(streamOf([
      toolChunk([{ id: "call-read", name: "list_files", arguments: "{}" }]),
    ]));
    const calls: string[] = [];
    const host = hostFor({ calls });

    await expect(runAgentLoop({
      harness,
      host,
      observer: observerRecording(calls),
      signal: new AbortController().signal,
      maxModelRounds: 1,
    })).rejects.toEqual(new AgentLoopLimitError(1));

    expect(host.recordToolRound).toHaveBeenCalledTimes(1);
    expect(host.executeToolRound).toHaveBeenCalledTimes(1);
    expect(llmCreate).toHaveBeenCalledTimes(1);
  });
});

function hostFor(overrides: Partial<AgentLoopHost<number, TestInvocation>> & {
  calls: string[];
}): AgentLoopHost<number, TestInvocation> {
  let round = 0;
  return {
    prepareModelRound: vi.fn(async () => {
      overrides.calls.push("prepare");
      return [];
    }),
    beginModelRound: vi.fn(async () => {
      round += 1;
      overrides.calls.push(`begin:${round}`);
      return round;
    }),
    withModelRequest: vi.fn(async (signal, request) => {
      overrides.calls.push("request");
      return request(signal);
    }),
    recordAssistantReply: vi.fn(async () => AgentLoopControl.Stop),
    recordToolRound: vi.fn(async (
      { toolCalls }: Parameters<
        AgentLoopHost<number, TestInvocation>["recordToolRound"]
      >[0],
    ) => toolCalls.map((call) => ({
      executionDomain: AgentToolExecutionDomain.Server,
      call,
    }))),
    updateContextBaseline: vi.fn(async () => undefined),
    rejectInvalidToolRound: vi.fn(async () => undefined),
    executeToolRound: vi.fn(async () => AgentLoopControl.Continue),
    ...overrides,
  };
}

function observerRecording(calls: string[]): AgentModelObserver {
  return {
    onTextDelta(delta) {
      calls.push(`text:${delta}`);
    },
    onToolCallStarted(call) {
      calls.push(`tool:${call.id}:${call.name}`);
    },
    onFileWriteDelta() {
      throw new Error("Unexpected write_file delta");
    },
  };
}

function toolChunk(toolCalls: readonly ToolCallMeta[]): ChatCompletionChunk {
  return chunk({
    tool_calls: toolCalls.map((call, index) => ({
      index,
      id: call.id,
      type: "function" as const,
      function: {
        name: call.name,
        arguments: call.arguments,
      },
    })),
  }, "tool_calls", usage);
}

function chunk(
  delta: ChatCompletionChunk.Choice.Delta,
  finishReason: ChatCompletionChunk.Choice["finish_reason"],
  providerUsage: typeof usage,
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
    usage: providerUsage,
  };
}

async function* streamOf(
  chunks: readonly ChatCompletionChunk[],
): AsyncGenerator<ChatCompletionChunk> {
  for (const item of chunks) yield item;
}
