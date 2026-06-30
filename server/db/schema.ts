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
import type {
  GenerateImageItemInput,
  GenerateImageJobResult,
  GenerateImageRunResult,
  GeneratedImageMimeType,
  ImageAssetSource,
  ImageJobError,
  ImageJobStatus,
  ImageProvider,
  ImageProviderModel,
  ImageRunStatus,
} from "../../types/image";

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

export const imageRuns = pgTable("image_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id").notNull(),
  status: text("status").$type<ImageRunStatus>().notNull(),
  result: jsonb("result").$type<GenerateImageRunResult>(),
  error: jsonb("error").$type<ImageJobError>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  ownerStatusIdx: index("idx_image_runs_owner_status").on(t.ownerId, t.status, t.createdAt),
  conversationStatusIdx: index("idx_image_runs_conversation_status").on(t.conversationId, t.status, t.createdAt),
  toolCallUnique: uniqueIndex("uq_image_runs_tool_call").on(t.conversationId, t.toolCallId).where(sql`${t.deletedAt} is null`),
}));

export const imageJobs = pgTable("image_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => imageRuns.id, { onDelete: "cascade" }),
  status: text("status").$type<ImageJobStatus>().notNull(),
  input: jsonb("input").$type<GenerateImageItemInput>().notNull(),
  result: jsonb("result").$type<GenerateImageJobResult>(),
  error: jsonb("error").$type<ImageJobError>(),
  provider: text("provider").$type<ImageProvider>().notNull(),
  providerModel: text("provider_model").$type<ImageProviderModel>().notNull(),
  providerJobId: text("provider_job_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  runStatusIdx: index("idx_image_jobs_run_status").on(t.runId, t.status, t.createdAt),
  providerPollIdx: index("idx_image_jobs_provider_poll").on(t.provider, t.providerModel, t.status, t.lastPolledAt),
}));

export const projectAssets = pgTable("project_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  imageJobId: uuid("image_job_id").references(() => imageJobs.id, { onDelete: "set null" }),
  source: text("source").$type<ImageAssetSource>().notNull(),
  mimeType: text("mime_type").$type<GeneratedImageMimeType>().notNull(),
  blobPath: text("blob_path").notNull(),
  publicUrl: text("public_url").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  projectIdx: index("idx_project_assets_project").on(t.projectId, t.createdAt),
  ownerIdx: index("idx_project_assets_owner").on(t.ownerId, t.createdAt),
  imageJobIdx: index("idx_project_assets_image_job").on(t.imageJobId),
}));

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

export const figmaConnections = pgTable("figma_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  figmaUserId: text("figma_user_id").notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  ownerIdx: index("idx_figma_connections_owner").on(t.ownerId),
  activeOwnerUnique: uniqueIndex("uq_figma_connections_active_owner")
    .on(t.ownerId)
    .where(sql`${t.revokedAt} is null`),
}));

export const oauthStates = pgTable("oauth_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  state: text("state").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  redirectTo: text("redirect_to").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  stateUnique: uniqueIndex("uq_oauth_states_state").on(t.state),
  ownerExpiryIdx: index("idx_oauth_states_owner_expires").on(t.ownerId, t.expiresAt),
}));
