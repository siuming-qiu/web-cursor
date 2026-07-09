/**
 * [INPUT]: attachment id from URL
 * [OUTPUT]: image binary stream for chat attachment preview
 * [POS]: A 域附件读取入口 —— 把 private Blob 转成浏览器可加载的图片响应
 * [PROTOCOL]: 只支持 GET；不返回 metadata；attachment id 来自已授权的会话历史响应。
 */
import { readAttachmentBlob, AttachmentError, AttachmentErrorCode } from "@/server/attachments";
import { z } from "zod";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const AttachmentIdSchema = z.string().uuid();

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsedId = AttachmentIdSchema.safeParse(id);
  if (!parsedId.success) {
    return Response.json({ error: "bad request", detail: parsedId.error.message }, { status: 400 });
  }

  try {
    const file = await readAttachmentBlob(parsedId.data);
    return new Response(file.stream, {
      headers: {
        "Content-Type": file.mimeType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof AttachmentError) {
      if (error.code === AttachmentErrorCode.NotFound) return new Response("Not Found", { status: 404 });
      return Response.json({ error: error.message, code: error.code }, { status: 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
