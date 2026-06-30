/**
 * [INPUT]: DB transcript rows for one conversation
 * [OUTPUT]: synthetic TOOL_INTERRUPTED tool message for an unclosed tool_call
 * [POS]: A 域 transcript 尾部兜底 —— 请求中断后补齐最后一个未闭合 tool_call
 * [PROTOCOL]: 只 append 兜底 tool result，不软删、不重排历史；LLM 上下文最终校验在 context.ts。
 */
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { imageRuns } from "@/server/db/schema";
import { appendMessage, listMessages } from "./messages";
import { ToolName, ToolResultType, type ToolCallMeta } from "@/types/tool";

type DbMessage = Awaited<ReturnType<typeof listMessages>>[number];

export function findUnclosedToolCall(rows: DbMessage[]): ToolCallMeta | null {
  const closed = new Set<string>();
  for (const row of rows) {
    const meta = (row.meta ?? {}) as { toolCallId?: string };
    if (row.role === "tool" && meta.toolCallId) closed.add(meta.toolCallId);
  }

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const meta = (row.meta ?? {}) as { toolCalls?: ToolCallMeta[] };
    if (row.role === "assistant" && meta.toolCalls?.length) {
      return meta.toolCalls.find((toolCall) => !closed.has(toolCall.id)) ?? null;
    }
  }

  return null;
}

export async function closeInterruptedToolCall(conversationId: string, rows: DbMessage[]) {
  const missing = findUnclosedToolCall(rows);
  if (!missing) return false;
  if (missing.name === ToolName.GenerateImage) {
    const [run] = await db
      .select({ id: imageRuns.id })
      .from(imageRuns)
      .where(and(
        eq(imageRuns.conversationId, conversationId),
        eq(imageRuns.toolCallId, missing.id),
        isNull(imageRuns.deletedAt),
      ))
      .limit(1);
    if (run) return false;
  }

  await appendMessage(conversationId, {
    role: "tool",
    content: JSON.stringify({
      status: "error",
      type: ToolResultType.ToolInterrupted,
      message: "Client did not return a tool result.",
    }),
    meta: { toolCallId: missing.id },
  });
  return true;
}
