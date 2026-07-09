/**
 * [INPUT]: 会话 id（URL）
 * [OUTPUT]: 该会话的 messages 数组（按 seq 升序，排除软删）
 * [POS]: A 域回放接口 —— 前端刷新后恢复整段对话用
 * [PROTOCOL]: 经 ownsConversation 反查归属（会话→项目→owner），不是你的返 404
 */
import { listMessages } from "@/server/messages";
import { ownsConversation } from "@/server/guard";
import { ownerIdFrom } from "@/server/owner";
import { listConversationAttachmentViews } from "@/server/attachments";
import { AttachmentSummarySchema, type AttachmentSummary } from "@/types/attachment";

type Ctx = { params: Promise<{ id: string }> };
type MessageRow = Awaited<ReturnType<typeof listMessages>>[number];

const AttachmentMetaSchema = AttachmentSummarySchema.array();

function attachmentsFromMeta(meta: unknown): AttachmentSummary[] {
  const rawAttachments = (meta as { attachments?: unknown } | null)?.attachments;
  if (rawAttachments === undefined) return [];

  const parsed = AttachmentMetaSchema.safeParse(rawAttachments);
  if (!parsed.success) {
    console.warn("Invalid message attachment meta", parsed.error.message);
    return [];
  }
  return parsed.data;
}

function enrichRowAttachments(row: MessageRow, views: Map<string, AttachmentSummary>): MessageRow {
  if (row.role !== "user") return row;

  const attachments = attachmentsFromMeta(row.meta);
  if (attachments.length === 0) return row;

  const enriched = attachments.map((attachment) => {
    const view = views.get(attachment.id);
    if (!view) {
      console.warn(`Missing chat attachment view for message ${row.id}: ${attachment.id}`);
      return attachment;
    }
    return {
      ...attachment,
      name: view.name ?? attachment.name,
      previewUrl: view.previewUrl,
    };
  });

  return {
    ...row,
    meta: {
      ...(row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : {}),
      attachments: enriched,
    },
  };
}

export async function GET(req: Request, ctx: Ctx) {
  const ownerId = ownerIdFrom(req);
  if (!ownerId) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!(await ownsConversation(id, ownerId))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const rows = await listMessages(id);
  const attachmentIds = rows.flatMap((row) => attachmentsFromMeta(row.meta).map((attachment) => attachment.id));
  const views = await listConversationAttachmentViews(id, [...new Set(attachmentIds)]);

  return Response.json(rows.map((row) => enrichRowAttachments(row, views)));
}
