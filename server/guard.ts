/**
 * [INPUT]: projectId / conversationId + ownerId
 * [OUTPUT]: 该资源是否属于这个 owner（且未软删）
 * [POS]: A 域归属校验 —— 防跨 owner 读写；非鉴权但隔离数据
 * [PROTOCOL]: 会话经 project 反查 owner；project 软删后其会话/消息也视为不可达
 */
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { conversations, projects } from "./db/schema";

/** project 是否属于该 owner 且存活。 */
export async function ownsProject(projectId: string, ownerId: string): Promise<boolean> {
  const [p] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId), isNull(projects.deletedAt)))
    .limit(1);
  return !!p;
}

/** conversation 经 project 反查 owner：会话存活 + 所属 project 属于该 owner 且存活。 */
export async function ownsConversation(conversationId: string, ownerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(projects, eq(conversations.projectId, projects.id))
    .where(and(
      eq(conversations.id, conversationId),
      isNull(conversations.deletedAt),
      eq(projects.ownerId, ownerId),
      isNull(projects.deletedAt),
    ))
    .limit(1);
  return !!row;
}

/** conversation -> projectId，同时校验 owner 和软删状态。 */
export async function getOwnedConversationProjectId(conversationId: string, ownerId: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: conversations.projectId })
    .from(conversations)
    .innerJoin(projects, eq(conversations.projectId, projects.id))
    .where(and(
      eq(conversations.id, conversationId),
      isNull(conversations.deletedAt),
      eq(projects.ownerId, ownerId),
      isNull(projects.deletedAt),
    ))
    .limit(1);
  return row?.projectId ?? null;
}
