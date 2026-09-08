/**
 * [INPUT]: exact Agent harness, host-owned lifecycle callbacks, model observer, AbortSignal, optional round cap
 * [OUTPUT]: one reusable model/tool Agent loop with strict streamed tool-call assembly
 * [POS]: A 域通用 Agent loop kernel；持久化、transport 与具体工具副作用由 Host 持有
 * [PROTOCOL]: model round -> streamed assistant -> Host-recorded tool round -> usage baseline -> tool execution；
 *   非法 mixed/async round 必须先交给 Host 闭合结果，再进入下一轮
 */
import "server-only";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { ToolCallStreamAssembler } from "@/lib/agent/toolCallStreamAssembler";
import type { restoreAgentHarness } from "@/server/agentHarness";
import {
  ContextCompactionError,
  ContextCompactionErrorCode,
} from "@/server/contextCheckpoint";
import {
  DeepSeekUsageSchema,
  type DeepSeekUsage,
} from "@/server/contextTokenEstimate";
import llmClient from "@/server/llm";
import {
  extractWriteFileStreamUpdate,
  type WriteFileStreamState,
} from "@/server/writeFileStream";
import {
  AgentToolExecutionDomain,
  type AgentToolExecutionDomain as AgentToolExecutionDomainValue,
} from "@/types/agentRun";
import { ToolName, type ToolCallMeta } from "@/types/tool";

type ResolvedAgentHarness = ReturnType<typeof restoreAgentHarness>;

type DeepSeekStreamingParams = ChatCompletionCreateParamsStreaming & {
  thinking: { type: "disabled" };
};

export type AgentModelHarness = Pick<
  ResolvedAgentHarness,
  "model" | "tools" | "toolChoice" | "stream" | "thinking"
>;

export interface AgentModelObserver {
  onTextDelta(delta: string): void;
  onToolCallStarted(call: { index: number; id: string; name: string }): void;
  onFileWriteDelta(update: {
    toolCallId: string;
    path: string | undefined;
    delta: string | undefined;
  }): void;
}

export interface AgentLoopInvocation {
  executionDomain: AgentToolExecutionDomainValue;
}

export const AgentLoopControl = {
  Continue: "continue",
  Stop: "stop",
} as const;

export type AgentLoopControl =
  typeof AgentLoopControl[keyof typeof AgentLoopControl];

export class AgentLoopLimitError extends Error {
  constructor(readonly maxModelRounds: number) {
    super(`Agent loop exceeded maxModelRounds ${maxModelRounds}.`);
    this.name = "AgentLoopLimitError";
  }
}

export interface AgentLoopHost<
  TModelRound,
  TInvocation extends AgentLoopInvocation,
> {
  prepareModelRound(signal: AbortSignal): Promise<
    ChatCompletionCreateParamsStreaming["messages"]
  >;
  beginModelRound(): Promise<TModelRound>;
  withModelRequest<T>(
    signal: AbortSignal,
    request: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
  recordAssistantReply(text: string): Promise<AgentLoopControl>;
  recordToolRound(input: {
    modelRound: TModelRound;
    text: string;
    toolCalls: readonly ToolCallMeta[];
  }): Promise<TInvocation[]>;
  updateContextBaseline(usage: DeepSeekUsage): Promise<void>;
  rejectInvalidToolRound(input: {
    invocations: readonly TInvocation[];
    message: string;
  }): Promise<void>;
  executeToolRound(input: {
    invocations: readonly TInvocation[];
    signal: AbortSignal;
  }): Promise<AgentLoopControl>;
}

const InvalidToolRoundMessage = {
  MixedDomains:
    "A tool-call round cannot mix client, server, and async execution domains.",
  MultipleAsync:
    "A tool-call round may contain only one async generate_image invocation.",
} as const;

async function requestAssistant(
  messages: ChatCompletionCreateParamsStreaming["messages"],
  harness: AgentModelHarness,
  signal: AbortSignal,
) {
  const params: DeepSeekStreamingParams = {
    messages,
    model: harness.model,
    tools: harness.tools,
    tool_choice: harness.toolChoice,
    stream: harness.stream,
    stream_options: { include_usage: true },
    thinking: harness.thinking,
  };
  return llmClient.chat.completions.create(params, { signal });
}

export async function collectAssistantTurn(
  messages: ChatCompletionCreateParamsStreaming["messages"],
  harness: AgentModelHarness,
  observer: AgentModelObserver,
  signal: AbortSignal,
): Promise<{
  text: string;
  toolCalls: ToolCallMeta[];
  usage: DeepSeekUsage;
}> {
  const stream = await requestAssistant(messages, harness, signal);
  const toolCalls = new ToolCallStreamAssembler();
  const announced = new Set<number>();
  const fileStreams = new Map<number, WriteFileStreamState>();
  let text = "";
  let usage: DeepSeekUsage | null = null;

  for await (const chunk of stream) {
    signal.throwIfAborted();
    if (chunk.usage) {
      const parsed = DeepSeekUsageSchema.safeParse(chunk.usage);
      if (!parsed.success) {
        throw new ContextCompactionError(
          ContextCompactionErrorCode.ProviderUsageInvalid,
          parsed.error.message,
        );
      }
      if (usage && usage.total_tokens !== parsed.data.total_tokens) {
        throw new ContextCompactionError(
          ContextCompactionErrorCode.ProviderUsageInvalid,
          "DeepSeek emitted conflicting total_tokens values.",
        );
      }
      usage = parsed.data;
    }
    const choice = chunk.choices[0];
    toolCalls.observeFinishReason(choice?.finish_reason);
    const delta = choice?.delta;
    if (delta?.content) {
      text += delta.content;
      observer.onTextDelta(delta.content);
    }

    for (const toolDelta of delta?.tool_calls ?? []) {
      const next = toolCalls.append(toolDelta);
      if (
        next.id
        && next.name === ToolName.WriteFile
        && next.arguments !== undefined
        && typeof toolDelta.function?.arguments === "string"
        && toolDelta.function.arguments.length > 0
      ) {
        const update = extractWriteFileStreamUpdate(
          next.arguments,
          fileStreams.get(next.index),
        );
        if (update) {
          fileStreams.set(next.index, update.state);
          if (update.path || update.delta) {
            observer.onFileWriteDelta({
              toolCallId: next.id,
              path: update.path,
              delta: update.delta,
            });
          }
        }
      }

      if (next.id && next.name && !announced.has(next.index)) {
        announced.add(next.index);
        observer.onToolCallStarted({
          index: next.index,
          id: next.id,
          name: next.name,
        });
      }
    }
  }

  if (!usage) {
    throw new ContextCompactionError(
      ContextCompactionErrorCode.ProviderUsageMissing,
      "DeepSeek stream ended without the requested usage chunk.",
    );
  }
  return { text, toolCalls: toolCalls.finish(), usage };
}

function invalidToolRoundMessage(
  invocations: readonly AgentLoopInvocation[],
): string | null {
  const domains = new Set(invocations.map(({ executionDomain }) => executionDomain));
  if (domains.size > 1) return InvalidToolRoundMessage.MixedDomains;
  if (
    domains.has(AgentToolExecutionDomain.Async)
    && invocations.length > 1
  ) {
    return InvalidToolRoundMessage.MultipleAsync;
  }
  return null;
}

export async function runAgentLoop<
  TModelRound,
  TInvocation extends AgentLoopInvocation,
>(input: {
  harness: AgentModelHarness;
  host: AgentLoopHost<TModelRound, TInvocation>;
  observer: AgentModelObserver;
  signal: AbortSignal;
  maxModelRounds?: number;
}): Promise<void> {
  if (
    input.maxModelRounds !== undefined
    && (!Number.isInteger(input.maxModelRounds) || input.maxModelRounds < 1)
  ) {
    throw new TypeError("maxModelRounds must be a positive integer.");
  }

  let modelRounds = 0;
  while (true) {
    input.signal.throwIfAborted();
    if (
      input.maxModelRounds !== undefined
      && modelRounds >= input.maxModelRounds
    ) {
      throw new AgentLoopLimitError(input.maxModelRounds);
    }
    modelRounds += 1;
    const messages = await input.host.prepareModelRound(input.signal);
    const modelRound = await input.host.beginModelRound();
    const assistant = await input.host.withModelRequest(
      input.signal,
      (modelSignal) => collectAssistantTurn(
        messages,
        input.harness,
        input.observer,
        modelSignal,
      ),
    );
    input.signal.throwIfAborted();

    if (assistant.toolCalls.length === 0) {
      const control = await input.host.recordAssistantReply(assistant.text);
      if (control === AgentLoopControl.Stop) return;
      continue;
    }

    const invocations = await input.host.recordToolRound({
      modelRound,
      text: assistant.text,
      toolCalls: assistant.toolCalls,
    });
    await input.host.updateContextBaseline(assistant.usage);

    const rejection = invalidToolRoundMessage(invocations);
    if (rejection) {
      await input.host.rejectInvalidToolRound({
        invocations,
        message: rejection,
      });
      continue;
    }

    const control = await input.host.executeToolRound({
      invocations,
      signal: input.signal,
    });
    if (control === AgentLoopControl.Stop) return;
  }
}
