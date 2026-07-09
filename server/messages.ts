/**
 * [INPUT]: conversationId + 消息字段
 * [OUTPUT]: appendMessage 追加一条；listMessages 列某会话的消息数组
 * [POS]: A 域 messages 表读写 —— /api/chat 落库 + GET messages 回放都走它
 * [PROTOCOL]: seq 由 DB identity 原子分配（insert 不传 seq）；读一律按 seq 升序、排除软删
 *   appendMessage 可传入 tx，让"状态跃迁 + 追加消息"在同一事务里成对提交
 */
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { messages } from "./db/schema";

type NewMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  model?: string;
  meta?: unknown;
};

/** db 或 db.transaction 的 tx 都能写消息。 */
type MessageWriter = Pick<typeof db, "insert">;

/** 追加一条消息：不传 seq（DB identity 原子分配，多实例无竞态）。 */
export async function appendMessage(conversationId: string, m: NewMessage, writer: MessageWriter = db) {
  const [row] = await writer.insert(messages).values({ conversationId, ...m }).returning();
  return row;
}

/** 列某会话的消息：按 seq 升序、排除软删。SQL: WHERE conversation_id=$1 AND deleted_at IS NULL ORDER BY seq */
export function listMessages(conversationId: string) {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
    .orderBy(asc(messages.seq));
}
