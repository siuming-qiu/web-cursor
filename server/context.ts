/**
 * [INPUT]: 从 DB 读出的 messages 行（listMessages 的结果）
 * [OUTPUT]: DeepSeek 能直接吃的 messages 数组（外层再自行加 system）
 * [POS]: A 域上下文重建 —— 把 transcript 还原成 function-calling 结构（B 方案）
 * [PROTOCOL]: assistant 还原 tool_calls（id + arguments）、tool 还原 tool_call_id，二者成对喂回；
 *   DeepSeek 硬规则：带 tool_calls 的 assistant 后面必须紧跟对应的 tool 消息。
 */
import "server-only";
import type OpenAI from "openai";
import type { messages } from "./db/schema";
import type { AttachmentSummary } from "@/types/attachment";
import { ToolResultType, type ToolCallMeta } from "@/types/tool";

type DbMessage = typeof messages.$inferSelect;        // drizzle 自动推断的行类型
type LLMMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Meta = { toolCalls?: ToolCallMeta[]; toolCallId?: string; attachments?: AttachmentSummary[] };

function userContent(content: string, attachments: AttachmentSummary[] | undefined): string {
  if (!attachments?.length) return content;

  const lines = attachments.map((attachment) =>
    `- attachmentId=${attachment.id}; type=${attachment.type}; mimeType=${attachment.mimeType}; sizeBytes=${attachment.sizeBytes}`
  );
  return [
    content,
    "",
    "用户本轮附带了以下附件。需要读取附件内容时，必须调用 inspect_attachment，并只能使用这里列出的 attachmentId：",
    ...lines,
  ].join("\n");
}

function assistantToolMessage(toolCalls: ToolCallMeta[]): LLMMessage {
  return {
    role: "assistant",
    content: "",
    tool_calls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function" as const,
      function: { name: toolCall.name, arguments: toolCall.arguments ?? "{}" },
    })),
  };
}

function toolMessage(toolCallId: string, content: string): LLMMessage {
  return { role: "tool", tool_call_id: toolCallId, content };
}

function missingToolMessage(toolCallId: string): LLMMessage {
  return toolMessage(
    toolCallId,
    JSON.stringify({
      status: "error",
      type: ToolResultType.ToolInterrupted,
      message: "Tool result was missing from the stored transcript.",
    }),
  );
}

/** DB transcript → DeepSeek messages（function-calling 成对还原）。 */
export function toLLMMessages(rows: DbMessage[]): LLMMessage[] {
  const result: LLMMessage[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const meta = (row.meta ?? {}) as Meta;

    if (row.role === "user") {
      result.push({ role: "user", content: userContent(row.content, meta.attachments) });
      continue;
    }

    if (row.role === "assistant") {
      if (!meta.toolCalls?.length) {
        result.push({ role: "assistant", content: row.content });
        continue;
      }

      result.push(assistantToolMessage(meta.toolCalls));
      for (const toolCall of meta.toolCalls) {
        const next = rows[i + 1];
        const nextMeta = (next?.meta ?? {}) as Meta;
        if (next?.role === "tool" && nextMeta.toolCallId === toolCall.id) {
          result.push(toolMessage(toolCall.id, next.content));
          i += 1;
        } else {
          result.push(missingToolMessage(toolCall.id));
        }
      }
      continue;
    }

    // Orphan or late tool messages are invalid for the LLM API. They are only
    // included when consumed immediately after their assistant.tool_calls above.
  }

  return result;
}
