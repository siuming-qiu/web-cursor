/**
 * [INPUT]: owner-scoped attachment upload body with explicit image dataUrl
 * [OUTPUT]: attachment metadata id for later /api/chat turns
 * [POS]: A 域附件上传入口 —— 前端截图先上传到 Vercel Blob，再让 agent 用 attachmentId inspect
 * [PROTOCOL]: 只支持 POST；body 由 UploadAttachmentSchema 严格校验，图片内容不写入 messages
 */
import { uploadAttachment, AttachmentError } from "@/server/attachments";
import { ownsProject } from "@/server/guard";
import { UploadAttachmentSchema } from "@/types/attachment";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ownerId = req.headers.get("x-owner-id");
  if (!ownerId) return new Response("Unauthorized", { status: 401 });

  const parsed = UploadAttachmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad request", detail: parsed.error.message }, { status: 400 });
  }

  if (parsed.data.projectId && !(await ownsProject(parsed.data.projectId, ownerId))) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    return Response.json(await uploadAttachment(ownerId, parsed.data));
  } catch (error) {
    if (error instanceof AttachmentError) {
      return Response.json({ error: error.message, code: error.code }, { status: 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
