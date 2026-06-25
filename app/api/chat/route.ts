/**
 * [INPUT]: kind=user 的用户消息，或 kind=resume 的已闭合 transcript 续写请求
 * [OUTPUT]: SSE(init/tools_call/tool_result/files_changed/chat/done/error)，并落库完整 transcript
 * [POS]: A 域 LLM Agent loop —— 持 key、读 DB transcript、执行后端文件工具、流式转发
 * [PROTOCOL]: LLM 工具由 server/tools/definitions.ts 定义，由 server/tools/executor.ts 执行；
 *   文件当前态只在 project_files，不再从 assistant message 恢复代码。
 */
import { toLLMMessages } from "@/server/context";
import { db } from "@/server/db";
import { conversations, projects } from "@/server/db/schema";
import deepseekClient, { SYSTEM_PROMPT, tools } from "@/server/deepseek";
import { getOwnedConversationProjectId, ownsConversation, ownsProject } from "@/server/guard";
import { appendMessage, listMessages } from "@/server/messages";
import { closeInterruptedToolCall } from "@/server/toolCalls";
import { updateGeneratedTitles } from "@/server/titles";
import { executeToolCall, type ToolExecutionContext } from "@/server/tools/executor";
import { ChatEventType, ChatTurnSchema, type ChatEvent, type ChatTurn } from "@/types/chat";
import { ToolName, type ToolCallMeta } from "@/types/tool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbMessage = Awaited<ReturnType<typeof listMessages>>[number];

const MAX_TOOL_ROUNDS = 8;
const MODEL = "deepseek-v4-pro";

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
  return deepseekClient.chat.completions.create({
    messages: assistantMessages(rows),
    model: MODEL,
    tools,
    stream: true,
  });
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

function toolChangesFiles(name: string) {
  return FILE_MUTATION_TOOLS.includes(name as (typeof FILE_MUTATION_TOOLS)[number]);
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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let rows = await listMessages(conversationId);
    if (await closeInterruptedToolCall(conversationId, rows)) {
      rows = await listMessages(conversationId);
    }

    const assistant = await collectAssistantTurn(rows, send);

    if (assistant.toolCalls.length === 0) {
      if (assistant.text) {
        await appendMessage(conversationId, {
          role: "assistant",
          content: assistant.text,
          model: MODEL,
          meta: { kind: "reply" },
        });
        if (userMessage) {
          try {
            const titleUpdate = await updateGeneratedTitles({
              conversationId,
              projectId,
              userMessage,
              assistantContent: assistant.text,
            });
            if (titleUpdate) send({ type: ChatEventType.Title, conversationId, ...titleUpdate });
          } catch (titleError) {
            console.warn("Failed to generate chat title", titleError);
          }
        }
      }
      send({ type: ChatEventType.Done });
      return;
    }

    await appendMessage(conversationId, {
      role: "assistant",
      content: assistant.text,
      model: MODEL,
      meta: { toolCalls: assistant.toolCalls },
    });

    const ctx: ToolExecutionContext = {
      ownerId,
      projectId,
      conversationId,
    };

    for (const toolCall of assistant.toolCalls) {
      const result = await executeToolCall(toolCall, ctx);
      await appendMessage(conversationId, {
        role: "tool",
        content: JSON.stringify(result),
        meta: { toolCallId: toolCall.id },
      });

      send({ type: ChatEventType.ToolResult, name: toolCall.name, status: result.status });

      if (toolChangesFiles(toolCall.name)) {
        send({ type: ChatEventType.FilesChanged });
      }

      if (result.status === "ok" && result.tool === ToolName.Reply) {
        send({ type: ChatEventType.Chat, delta: result.message });
        await appendMessage(conversationId, {
          role: "assistant",
          content: result.message,
          model: MODEL,
          meta: { kind: "reply" },
        });
        send({ type: ChatEventType.Done });
        return;
      }
    }
  }

  send({ type: ChatEventType.Error, message: `工具调用超过上限 ${MAX_TOOL_ROUNDS} 轮，已停止。` });
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
    return streamAgent({ conversationId: body.conversationId, projectId, ownerId, created: false });
  }

  let { conversationId, projectId } = body;
  const created = !conversationId;

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
      const [project] = await db.insert(projects).values({ ownerId, title: "untitled" }).returning();
      projectId = project.id;
    }
    const [conversation] = await db.insert(conversations).values({ projectId, title: "untitled" }).returning();
    conversationId = conversation.id;
  }

  await appendMessage(conversationId, {
    role: "user",
    content: body.message,
  });

  return streamAgent({ conversationId, projectId, ownerId, created, userMessage: body.message });
}
