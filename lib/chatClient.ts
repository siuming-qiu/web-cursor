/**
 * [INPUT]: 一个 chat turn（用户需求 / resume 续写）+ 当前 project/conversation id
 * [OUTPUT]: 流式 ChatEvent（init / code 增量 / chat 文本 / done / error）
 * [POS]: B 域 → A 域后端的调用门面。对接 /api/chat 的 SSE 协议，自带 x-owner-id。
 * [PROTOCOL]: code 是增量 delta；tool result 走 postToolResult，只闭合 tool_call，不触发 LLM。
 */
"use client";

import { getOwnerId } from "./owner";
import { localeHeaderName } from "@/i18n/locales";
import type { ChatEvent, ChatTurn } from "@/types/chat";
import type { ToolResult } from "@/types/tool";

/** 调后端 /api/chat，逐条 yield SSE 事件。自带 x-owner-id；流关闭即结束。 */
export async function* streamChat(turn: ChatTurn, locale: string): AsyncIterable<ChatEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-owner-id": getOwnerId(), [localeHeaderName]: locale },
    body: JSON.stringify(turn),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`/api/chat ${res.status} ${detail}`.trim());
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE 事件之间以空行（\n\n）分隔
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const evt of events) {
      const dataLine = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const data = dataLine.slice(5).trim();
      if (!data) continue;
      try {
        yield JSON.parse(data) as ChatEvent;
      } catch {
        // 半截/心跳，忽略
      }
    }
  }
}

/** Close one pending model tool call. This records execution result only; it never calls the LLM. */
export async function postToolResult(conversationId: string, toolCallId: string, result: ToolResult): Promise<void> {
  const res = await fetch(`/api/conversations/${conversationId}/tool-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-owner-id": getOwnerId() },
    body: JSON.stringify({ toolCallId, result }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`/api/conversations/${conversationId}/tool-results ${res.status} ${detail}`.trim());
  }
}
