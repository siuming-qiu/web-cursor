/**
 * [INPUT]: published showcase slug/list request
 * [OUTPUT]: public read-only showcase data assembled from DB truth tables
 * [POS]: A 域公开案例查询层 —— 只读读取 showcase_cases 指向的项目、会话、消息、文件
 * [PROTOCOL]: 只返回 publishedAt 非空且 revokedAt 为空的案例；不暴露任意 project/conversation 读取。
 */
import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { conversations, imageJobs, imageRuns, projectFiles, projects, showcaseCases } from "@/server/db/schema";
import { listMessages } from "@/server/messages";
import { listConversationAttachmentViews } from "@/server/attachments";
import { AttachmentSummarySchema, type AttachmentSummary } from "@/types/attachment";
import type { ShowcaseDetail, ShowcaseListItem, ShowcaseMessage } from "@/lib/showcaseTypes";
import { ToolName } from "@/types/tool";

type MessageRow = Awaited<ReturnType<typeof listMessages>>[number];

const AttachmentMetaSchema = AttachmentSummarySchema.array();

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function attachmentsFromMeta(meta: unknown): AttachmentSummary[] {
  const rawAttachments = (meta as { attachments?: unknown } | null)?.attachments;
  if (rawAttachments === undefined) return [];

  const parsed = AttachmentMetaSchema.safeParse(rawAttachments);
  if (!parsed.success) {
    console.warn("Invalid showcase attachment meta", parsed.error.message);
    return [];
  }
  return parsed.data;
}

function enrichMessage(row: MessageRow, views: Map<string, AttachmentSummary>): ShowcaseMessage {
  const base: ShowcaseMessage = {
    id: row.id,
    role: row.role as ShowcaseMessage["role"],
    content: row.content,
    meta: row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
      ? row.meta as ShowcaseMessage["meta"]
      : undefined,
  };
  if (row.role !== "user") return base;

  const attachments = attachmentsFromMeta(row.meta);
  if (attachments.length === 0) return base;

  return {
    ...base,
    meta: {
      ...(base.meta ?? {}),
      attachments: attachments.map((attachment) => {
        const view = views.get(attachment.id);
        if (!view) {
          console.warn(`Missing showcase attachment view for message ${row.id}: ${attachment.id}`);
          return attachment;
        }
        return {
          ...attachment,
          name: view.name ?? attachment.name,
          previewUrl: view.previewUrl,
        };
      }),
    },
  };
}

function assistantToolCallIds(meta: unknown): string[] {
  const toolCalls = (meta as { toolCalls?: { id?: unknown; name?: unknown }[] } | null)?.toolCalls;
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .filter((toolCall) => toolCall.name === ToolName.GenerateImage && typeof toolCall.id === "string")
    .map((toolCall) => toolCall.id as string);
}

async function listImageRuns(conversationId: string) {
  const runs = await db
    .select({
      runId: imageRuns.id,
      toolCallId: imageRuns.toolCallId,
      status: imageRuns.status,
      result: imageRuns.result,
      error: imageRuns.error,
      createdAt: imageRuns.createdAt,
    })
    .from(imageRuns)
    .where(and(eq(imageRuns.conversationId, conversationId), isNull(imageRuns.deletedAt)))
    .orderBy(asc(imageRuns.createdAt));

  if (!runs.length) return [];

  const jobs = await db
    .select({
      id: imageJobs.id,
      runId: imageJobs.runId,
      status: imageJobs.status,
      input: imageJobs.input,
      result: imageJobs.result,
      error: imageJobs.error,
      createdAt: imageJobs.createdAt,
    })
    .from(imageJobs)
    .where(and(inArray(imageJobs.runId, runs.map((run) => run.runId)), isNull(imageJobs.deletedAt)))

  const jobsByRunId = new Map<string, typeof jobs>();
  for (const job of jobs) {
    jobsByRunId.set(job.runId, [...(jobsByRunId.get(job.runId) ?? []), job]);
  }

  return runs.map((run) => ({
    ...run,
    jobs: jobsByRunId.get(run.runId) ?? [],
  }));
}

function attachImageRuns(messages: ShowcaseMessage[], runs: Awaited<ReturnType<typeof listImageRuns>>): ShowcaseMessage[] {
  const byToolCallId = new Map<string, typeof runs>();
  for (const run of runs) {
    byToolCallId.set(run.toolCallId, [...(byToolCallId.get(run.toolCallId) ?? []), run]);
  }

  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    const messageRuns = assistantToolCallIds(message.meta).flatMap((toolCallId) => byToolCallId.get(toolCallId) ?? []);
    return messageRuns.length ? { ...message, imageRuns: messageRuns } : message;
  });
}

const publishedWhere = and(
  isNotNull(showcaseCases.publishedAt),
  isNull(showcaseCases.revokedAt),
);

export async function listPublishedShowcaseCases(): Promise<ShowcaseListItem[]> {
  const rows = await db
    .select({
      slug: showcaseCases.slug,
      title: showcaseCases.title,
      description: showcaseCases.description,
      publishedAt: showcaseCases.publishedAt,
      projectTitle: projects.title,
      conversationTitle: conversations.title,
    })
    .from(showcaseCases)
    .innerJoin(projects, eq(showcaseCases.projectId, projects.id))
    .innerJoin(conversations, eq(showcaseCases.conversationId, conversations.id))
    .where(and(
      publishedWhere,
      isNull(projects.deletedAt),
      isNull(conversations.deletedAt),
    ))
    .orderBy(asc(showcaseCases.sortOrder), desc(showcaseCases.publishedAt));

  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    description: row.description ?? undefined,
    projectTitle: row.projectTitle,
    conversationTitle: row.conversationTitle ?? undefined,
    publishedAt: row.publishedAt ? iso(row.publishedAt) : "",
  }));
}

export async function getPublishedShowcaseCase(slug: string): Promise<ShowcaseDetail | null> {
  const [row] = await db
    .select({
      slug: showcaseCases.slug,
      title: showcaseCases.title,
      description: showcaseCases.description,
      publishedAt: showcaseCases.publishedAt,
      projectId: showcaseCases.projectId,
      conversationId: showcaseCases.conversationId,
      projectTitle: projects.title,
      conversationTitle: conversations.title,
    })
    .from(showcaseCases)
    .innerJoin(projects, eq(showcaseCases.projectId, projects.id))
    .innerJoin(conversations, eq(showcaseCases.conversationId, conversations.id))
    .where(and(
      eq(showcaseCases.slug, slug),
      publishedWhere,
      isNull(projects.deletedAt),
      isNull(conversations.deletedAt),
    ))
    .limit(1);

  if (!row || !row.publishedAt) return null;

  const [messages, runs, files] = await Promise.all([
    listMessages(row.conversationId),
    listImageRuns(row.conversationId),
    db
      .select({
        path: projectFiles.path,
        content: projectFiles.content,
        updatedAt: projectFiles.updatedAt,
      })
      .from(projectFiles)
      .where(and(eq(projectFiles.projectId, row.projectId), isNull(projectFiles.deletedAt)))
      .orderBy(asc(projectFiles.path)),
  ]);
  const attachmentIds = messages.flatMap((message) => attachmentsFromMeta(message.meta).map((attachment) => attachment.id));
  const attachmentViews = await listConversationAttachmentViews(row.conversationId, [...new Set(attachmentIds)]);
  const enrichedMessages = messages.map((message) => enrichMessage(message, attachmentViews));

  return {
    slug: row.slug,
    title: row.title,
    description: row.description ?? undefined,
    projectTitle: row.projectTitle,
    conversationTitle: row.conversationTitle ?? undefined,
    publishedAt: iso(row.publishedAt),
    files: files.map((file) => ({
      path: file.path,
      content: file.content,
      updatedAt: iso(file.updatedAt),
    })),
    messages: attachImageRuns(enrichedMessages, runs),
  };
}
