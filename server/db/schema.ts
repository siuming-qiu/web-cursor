/**
 * [INPUT]: 无（纯表定义）
 * [OUTPUT]: drizzle 表对象，供 lib/db/index.ts 与各 Route Handler import
 * [POS]: A 域持久层 schema —— Cursor 模型：项目=共享代码库，项目下多条对话线索
 *   关系：projects 1—N {project_files(共享代码), conversations 1—N messages(各线索的聊天)}
 * [PROTOCOL]: 改表先改这里 + 跑 pnpm db:push
 *   - 代码(project_files)挂项目、**会话间共享**：切会话只换聊天记录，代码不随会话变
 *   - seq 用 identity（多实例防竞态，禁 MAX+1）
 *   - 四表均软删 deleted_at（null=存活）；所有读 filter isNull(deletedAt)，DELETE=软删
 */
import {
  pgTable, uuid, text, timestamp, jsonb, bigint, index, uniqueIndex, integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),     // 软删：null=存活
}, (t) => ({ ownerIdx: index("idx_projects_owner").on(t.ownerId) }));

// 代码文件：挂项目、会话间共享（一期一行 App.jsx，结构支持二期多文件）
export const projectFiles = pgTable("project_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  // 部分唯一索引：只约束未软删的行，否则软删后建同名 path 会撞唯一约束
  uqPath: uniqueIndex("uq_file_path").on(t.projectId, t.path).where(sql`${t.deletedAt} is null`),
}));

// 对话线索：一个项目下可有多条，各自独立聊天记录（都对着项目的共享代码）
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  // 全局自增，Postgres 原子分配；多实例并发写不竞态。只用于会话内 ORDER BY，跳号无所谓。
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  role: text("role").notNull(),              // user | assistant | tool | system
  content: text("content").notNull(),
  model: text("model"),                      // assistant 才有：用了哪个模型
  meta: jsonb("meta"),                       // tool 结果细节 / { kind:'code'|'reply', attempt, stack }
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({ convIdx: index("idx_messages_conv").on(t.conversationId, t.seq) }));

export const chatAttachments = pgTable("chat_attachments", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  mimeType: text("mime_type").notNull(),
  blobPath: text("blob_path").notNull(),
  blobUrl: text("blob_url").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  originalName: text("original_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  ownerIdx: index("idx_chat_attachments_owner").on(t.ownerId, t.createdAt),
  conversationIdx: index("idx_chat_attachments_conversation").on(t.conversationId),
}));
