/**
 * [INPUT]: REST 接口的 method / path / body
 * [OUTPUT]: 解析后的响应数据（泛型 T）；非 2xx 抛 Error
 * [POS]: B 域 → A 域 REST 调用门面 —— 统一带 x-owner-id、统一判错
 * [PROTOCOL]: 后端裸返数据（无 {ok,data} 信封，见 docs/backend-todo.md S6）；错误体形如 { error }
 *   注：流式的 /api/chat 走 lib/chatClient.ts（也要自带 x-owner-id），不走这里
 */
"use client";

import { getOwnerId } from "./owner";

type Method = "GET" | "POST";

/** 全局 fetch 封装：默认带 x-owner-id 头，非 2xx 抛错，2xx 返回解析后的数据。 */
export async function req<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "x-owner-id": getOwnerId() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `${method} ${path} ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
