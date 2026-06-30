/**
 * [INPUT]: kind=user 的用户消息，或 kind=resume 的已闭合 transcript 续写请求
 * [OUTPUT]: SSE(init/tools_call/tool_result/files_changed/chat/done/error)，并落库完整 transcript
 * [POS]: A 域 LLM Agent loop —— 持 key、读 DB transcript、执行后端文件工具、流式转发
 * [PROTOCOL]: LLM 工具由 server/tools/definitions.ts 定义，由 server/tools/executor.ts 执行；
 *   文件当前态只在 project_files，不再从 assistant message 恢复代码。
 */
import { toLLMMessages } from "@/server/context";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { db } from "@/server/db";
import { conversations, projects } from "@/server/db/schema";
import llmClient, { SYSTEM_PROMPT, tools } from "@/server/llm";
import { getOwnedConversationProjectId, ownsConversation, ownsProject } from "@/server/guard";
import { appendMessage, listMessages } from "@/server/messages";
import { attachToConversation, AttachmentError } from "@/server/attachments";
import { closeInterruptedToolCall } from "@/server/toolCalls";
import { makeInitialTitle, updateGeneratedTitlesFromUserMessage } from "@/server/titles";
import { executeToolCall, type ToolExecutionContext } from "@/server/tools/executor";
import { maybeAppendFigmaConnectionGate } from "@/server/integrations/figmaGate";
import { AGENT_MODEL } from "@/server/models";
import { ChatEventType, ChatTurnSchema, type ChatEvent, type ChatTurn } from "@/types/chat";
import { FileChangeOperation } from "@/types/chat";
import type { AttachmentSummary } from "@/types/attachment";
import type { IntegrationCardMeta } from "@/types/integration";
import { ToolName, type ToolCallMeta } from "@/types/tool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbMessage = Awaited<ReturnType<typeof listMessages>>[number];

const MAX_TOOL_ROUNDS = 16;

type DeepSeekStreamingParams = ChatCompletionCreateParamsStreaming & {
  thinking: { type: "disabled" };
};

function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function assistantMessages(rows: DbMessage[]) {
  return [{ role: "system" as const, content: SYSTEM_PROMPT }, ...toLLMMessages(rows)];
}

async function requestAssistant(rows: DbMessage[]) {
  const params: DeepSeekStreamingParams = {
    messages: assistantMessages(rows),
    model: AGENT_MODEL,
    tools,
    tool_choice: "required",
    stream: true,
    thinking: { type: "disabled" },
  };
  return llmClient.chat.completions.create(params);
}

async function collectAssistantTurn(
  rows: DbMessage[],
  send: (event: ChatEvent) => void,
): Promise<{ text: string; toolCalls: ToolCallMeta[] }> {
  const stream = await requestAssistant(rows);
  const toolCalls = new Map<number, ToolCallMeta>();
  let text = "";

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      text += delta.content;
      send({ type: ChatEventType.Chat, delta: delta.content });
    }

    for (const tc of delta?.tool_calls ?? []) {
      const index = tc.index ?? 0;
      const existing = toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
      const next: ToolCallMeta = {
        id: tc.id ?? existing.id,
        name: tc.function?.name ?? existing.name,
        arguments: (existing.arguments ?? "") + (tc.function?.arguments ?? ""),
      };
      toolCalls.set(index, next);

      if (tc.id) {
        send({
          type: ChatEventType.ToolsCall,
          index,
          id: tc.id,
          name: tc.function?.name ?? "",
        });
      }
    }
  }

  return {
    text,
    toolCalls: [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)
      .filter((call) => call.id && call.name),
  };
}

const FILE_MUTATION_TOOLS = [
  ToolName.WriteFile,
  ToolName.DeleteFile,
  ToolName.RenameFile,
] as const;

const CLIENT_EXECUTION_TOOLS = [ToolName.RunPreview] as const;

function toolChangesFiles(name: string) {
  return FILE_MUTATION_TOOLS.includes(name as (typeof FILE_MUTATION_TOOLS)[number]);
}

function toolRunsOnClient(name: string) {
  return CLIENT_EXECUTION_TOOLS.includes(name as (typeof CLIENT_EXECUTION_TOOLS)[number]);
}

function fileChangedEvent(
  result: Awaited<ReturnType<typeof executeToolCall>>,
): Extract<ChatEvent, { type: typeof ChatEventType.FilesChanged }> | null {
  if (result.status !== "ok") return null;

  if (result.tool === ToolName.WriteFile) {
    return { type: ChatEventType.FilesChanged, operation: FileChangeOperation.Write, path: result.path };
  }
  if (result.tool === ToolName.DeleteFile) {
    return { type: ChatEventType.FilesChanged, operation: FileChangeOperation.Delete, path: result.path };
  }
  if (result.tool === ToolName.RenameFile) {
    return {
      type: ChatEventType.FilesChanged,
      operation: FileChangeOperation.Rename,
      path: result.newPath,
      oldPath: result.oldPath,
    };
  }
  return null;
}

async function runAgentLoop({
  ownerId,
  conversationId,
  projectId,
  created,
  userMessage,
  send,
}: {
  ownerId: string;
  conversationId: string;
  projectId: string;
  created: boolean;
  userMessage?: string;
  send: (event: ChatEvent) => void;
}) {
  if (created) send({ type: ChatEventType.Init, conversationId, projectId });
  if (userMessage) {
    try {
      const titleUpdate = await updateGeneratedTitlesFromUserMessage({
        conversationId,
        projectId,
        userMessage,
      });
      if (titleUpdate) send({ type: ChatEventType.Title, conversationId, ...titleUpdate });
    } catch (titleError) {
      console.warn("Failed to generate chat title", titleError);
    }
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const rows = await listMessages(conversationId);
    const assistant = await collectAssistantTurn(rows, send);

    if (assistant.toolCalls.length === 0) {
      if (assistant.text) {
        await appendMessage(conversationId, {
          role: "assistant",
          content: assistant.text,
          model: AGENT_MODEL,
          meta: { kind: "reply" },
        });
      }
      send({ type: ChatEventType.Done });
      return;
    }

    await appendMessage(conversationId, {
      role: "assistant",
      content: assistant.text,
      model: AGENT_MODEL,
      meta: { toolCalls: assistant.toolCalls },
    });

    const ctx: ToolExecutionContext = {
      ownerId,
      projectId,
      conversationId,
    };

    for (const toolCall of assistant.toolCalls) {
      if (toolRunsOnClient(toolCall.name)) {
        send({
          type: ChatEventType.ToolsCall,
          index: 0,
          id: toolCall.id,
          name: toolCall.name,
        });
        return;
      }

      const result = await executeToolCall(toolCall, ctx);
      await appendMessage(conversationId, {
        role: "tool",
        content: JSON.stringify(result),
        meta: { toolCallId: toolCall.id },
      });

      send({ type: ChatEventType.ToolResult, name: toolCall.name, status: result.status });

      if (toolChangesFiles(toolCall.name)) {
        send(fileChangedEvent(result) ?? { type: ChatEventType.FilesChanged });
      }

      if (result.status === "ok" && result.tool === ToolName.Reply) {
        send({ type: ChatEventType.Chat, delta: result.message });
        await appendMessage(conversationId, {
          role: "assistant",
          content: result.message,
          model: AGENT_MODEL,
          meta: { kind: "reply" },
        });
        send({ type: ChatEventType.Done });
        return;
      }
    }
  }

  send({ type: ChatEventType.Error, message: `工具调用超过上限 ${MAX_TOOL_ROUNDS} 轮，已停止。` });
}

async function closeTailToolCallBeforeModelInput(conversationId: string) {
  const rows = await listMessages(conversationId);
  await closeInterruptedToolCall(conversationId, rows);
}

function streamAgent(args: {
  conversationId: string;
  projectId: string;
  ownerId: string;
  created: boolean;
  userMessage?: string;
}) {
  const encoder = new TextEncoder();

  return sseResponse(new ReadableStream({
    async start(controller) {
      const send = (event: ChatEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        await runAgentLoop({ ...args, send });
      } catch (error) {
        send({ type: ChatEventType.Error, message: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  }));
}

function streamStaticAssistant(args: {
  conversationId: string;
  projectId: string;
  created: boolean;
  content: string;
  integrationCard?: IntegrationCardMeta;
}) {
  const encoder = new TextEncoder();

  return sseResponse(new ReadableStream({
    start(controller) {
      const send = (event: ChatEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      if (args.created) send({ type: ChatEventType.Init, conversationId: args.conversationId, projectId: args.projectId });
      send({ type: ChatEventType.Chat, delta: args.content });
      if (args.integrationCard) {
        send({ type: ChatEventType.IntegrationCard, meta: args.integrationCard });
      }
      send({ type: ChatEventType.Done });
      controller.close();
    },
  }));
}

function previewFeedbackMessage(result: Extract<ChatTurn, { kind: "preview_feedback" }>["result"]) {
  if (result.status === "ok") {
    return `浏览器预览结果：${result.type}${result.durationMs ? `，耗时 ${result.durationMs}ms` : ""}。`;
  }

  return [
    `浏览器预览失败：${result.type}`,
    `错误信息：${result.message}`,
    result.type === "RUNTIME_ERROR" && result.stack ? `错误堆栈：${result.stack}` : "",
    "请根据这个真实预览结果继续修复项目文件；不要假设项目已经能运行。",
  ].filter(Boolean).join("\n");
}

export async function POST(req: Request) {
  const ownerId = req.headers.get("x-owner-id");
  if (!ownerId) return new Response("Unauthorized", { status: 401 });

  let body: ChatTurn;
  try {
    body = ChatTurnSchema.parse(await req.json());
  } catch (e) {
    return Response.json({ error: "bad request", detail: String(e) }, { status: 400 });
  }

  if (body.kind === "resume") {
    const projectId = await getOwnedConversationProjectId(body.conversationId, ownerId);
    if (!projectId) return new Response("Not Found", { status: 404 });
    await closeTailToolCallBeforeModelInput(body.conversationId);
    return streamAgent({ conversationId: body.conversationId, projectId, ownerId, created: false });
  }

  if (body.kind === "preview_feedback") {
    const projectId = await getOwnedConversationProjectId(body.conversationId, ownerId);
    if (!projectId) return new Response("Not Found", { status: 404 });

    await closeTailToolCallBeforeModelInput(body.conversationId);
    await appendMessage(body.conversationId, {
      role: "user",
      content: previewFeedbackMessage(body.result),
      meta: { previewResult: body.result },
    });

    return streamAgent({ conversationId: body.conversationId, projectId, ownerId, created: false });
  }

  let { conversationId, projectId } = body;
  const created = !conversationId;
  const initialTitle = makeInitialTitle(body.message);

  if (conversationId) {
    if (!(await ownsConversation(conversationId, ownerId))) {
      return new Response("Not Found", { status: 404 });
    }
    const ownedProjectId = await getOwnedConversationProjectId(conversationId, ownerId);
    if (!ownedProjectId) return new Response("Not Found", { status: 404 });
    projectId = ownedProjectId;
  } else {
    if (projectId) {
      if (!(await ownsProject(projectId, ownerId))) {
        return new Response("Not Found", { status: 404 });
      }
    } else {
      const [project] = await db.insert(projects).values({ ownerId, title: initialTitle }).returning();
      projectId = project.id;
    }
    const [conversation] = await db.insert(conversations).values({ projectId, title: initialTitle }).returning();
    conversationId = conversation.id;
  }

  let attachments: AttachmentSummary[] | undefined;
  const attachmentIds = body.attachments?.map((attachment) => attachment.id) ?? [];
  if (attachmentIds.length) {
    try {
      attachments = await attachToConversation({ ownerId, conversationId, projectId, attachmentIds });
    } catch (error) {
      if (error instanceof AttachmentError) {
        return Response.json({ error: error.message, code: error.code }, { status: 400 });
      }
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  await closeTailToolCallBeforeModelInput(conversationId);

  await appendMessage(conversationId, {
    role: "user",
    content: body.message,
    meta: attachments?.length ? { attachments } : undefined,
  });

  const figmaGate = await maybeAppendFigmaConnectionGate({
    ownerId,
    conversationId,
    message: body.message,
  });
  if (figmaGate) {
    return streamStaticAssistant({
      conversationId,
      projectId,
      created,
      content: figmaGate.content,
      integrationCard: figmaGate.meta,
    });
  }

  return streamAgent({ conversationId, projectId, ownerId, created, userMessage: body.message });
}
