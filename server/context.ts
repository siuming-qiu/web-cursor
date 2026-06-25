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
import type { ToolCallMeta } from "@/types/tool";

type DbMessage = typeof messages.$inferSelect;        // drizzle 自动推断的行类型
type LLMMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Meta = { toolCalls?: ToolCallMeta[]; toolCallId?: string };

/** DB transcript → DeepSeek messages（function-calling 成对还原）。 */
export function toLLMMessages(rows: DbMessage[]): LLMMessage[] {
  return rows.flatMap((m): LLMMessage[] => {
    const meta = (m.meta ?? {}) as Meta;

    if (m.role === "user") return [{ role: "user", content: m.content }];

    if (m.role === "assistant") {
      if (meta.toolCalls?.length) {
        // 发起了工具调用的 assistant：代码在 tool_call 的 arguments 里，content 留空
        return [{
          role: "assistant",
          content: "",
          tool_calls: meta.toolCalls.map((t) => ({
            id: t.id,
            type: "function" as const,
            function: { name: t.name, arguments: t.arguments ?? "{}" },
          })),
        }];
      }
      return [{ role: "assistant", content: m.content }];
    }

    if (m.role === "tool") {
      // 必须带 tool_call_id，且紧跟它对应的 assistant.tool_calls
      return [{ role: "tool", tool_call_id: meta.toolCallId ?? "", content: m.content }];
    }

    return []; // system 跳过（外层单独加）
  });
}
