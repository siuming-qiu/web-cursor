/**
 * [INPUT]: project id + {oldPath,newPath} + x-owner-id
 * [OUTPUT]: renamed file summary
 * [POS]: A 域文件 REST API —— 前端重命名/移动单文件
 * [PROTOCOL]: 冲突直接 409，不自动改名
 */
import { z } from "zod";
import { ownsProject } from "@/server/guard";
import { ownerIdFrom } from "@/server/owner";
import { FileOperationError, FileOperationErrorCode, renameProjectFile } from "@/server/files";

type Ctx = { params: Promise<{ id: string }> };

const RenameBodySchema = z.object({
  oldPath: z.string().min(1),
  newPath: z.string().min(1),
}).strict();

function fileError(error: unknown) {
  if (error instanceof FileOperationError) {
    const status = error.code === FileOperationErrorCode.NotFound
      ? 404
      : error.code === FileOperationErrorCode.Conflict
        ? 409
        : 400;
    return Response.json({ error: error.message, code: error.code }, { status });
  }
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

export async function POST(req: Request, ctx: Ctx) {
  const ownerId = ownerIdFrom(req);
  if (!ownerId) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  if (!(await ownsProject(id, ownerId))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  try {
    const body = RenameBodySchema.parse(await req.json());
    return Response.json(await renameProjectFile(id, body.oldPath, body.newPath));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "bad request", detail: error.flatten() }, { status: 400 });
    }
    return fileError(error);
  }
}
