/**
 * [INPUT]: owner-scoped attachment upload body with explicit image dataUrl
 * [OUTPUT]: attachment metadata id for later /api/chat turns
 * [POS]: A 域附件上传入口 —— 前端截图先上传到 Vercel Blob，再让 agent 用 attachmentId inspect
 * [PROTOCOL]: 只支持 POST；请求体先按字节上限截流再解析，body 由 UploadAttachmentSchema 严格校验，图片内容不写入 messages
 */
import { uploadAttachment, AttachmentError } from "@/server/attachments";
import { ownsProject } from "@/server/guard";
import { ownerIdFrom } from "@/server/owner";
import { UploadAttachmentSchema } from "@/types/attachment";

export const runtime = "nodejs";

// 图片解码后上限 5MB；base64 膨胀约 4/3，再留出 JSON 包装余量。
const MAX_UPLOAD_BODY_BYTES = 8 * 1024 * 1024;

type LimitedBodyReadResult =
  | { status: "ok"; body: string }
  | { status: "empty" }
  | { status: "too_large" };

/** 按字节上限读取请求体：超限立刻断流，不把大 body 全缓冲进内存。 */
async function readBodyWithinLimit(req: Request, limit: number): Promise<LimitedBodyReadResult> {
  const declaredLength = Number(req.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > limit) return { status: "too_large" };
  if (!req.body) return { status: "empty" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return { status: "too_large" };
    }
    chunks.push(value);
  }

  return { status: "ok", body: new TextDecoder().decode(Buffer.concat(chunks)) };
}

export async function POST(req: Request) {
  const ownerId = ownerIdFrom(req);
  if (!ownerId) return new Response("Unauthorized", { status: 401 });

  const raw = await readBodyWithinLimit(req, MAX_UPLOAD_BODY_BYTES);
  if (raw.status === "too_large") {
    return Response.json(
      { error: "payload too large", detail: `Request body exceeds ${MAX_UPLOAD_BODY_BYTES} bytes.` },
      { status: 413 },
    );
  }
  if (raw.status === "empty") {
    return Response.json({ error: "bad request", detail: "Body is required." }, { status: 400 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw.body);
  } catch {
    return Response.json({ error: "bad request", detail: "Body is not valid JSON." }, { status: 400 });
  }

  const parsed = UploadAttachmentSchema.safeParse(json);
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
