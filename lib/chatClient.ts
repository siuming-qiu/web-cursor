/**
 * [INPUT]: 一条 message（用户需求 / 自我修复的报错反馈）
 * [OUTPUT]: 流式 ChatEvent（code 快照 / chat 文本 / done / error）
 * [POS]: B 域 → A 域后端的调用门面。对接后端 /api/chat 的 SSE 协议。
 * [PROTOCOL]: 后端每条 `data: {type,...}`：code/chat 为"当前完整快照"，done 收尾，error 异常
 */
"use client";

export type ChatEvent =
  | { type: "code"; code: string }
  | { type: "chat"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** 调后端 /api/chat，逐条 yield 后端发来的 SSE 事件。流关闭即结束。 */
export async function* streamChat(message: string): AsyncIterable<ChatEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
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
