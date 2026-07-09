/**
 * [INPUT]: project id + GET path query 或 POST body(action=write/delete) + x-owner-id
 * [OUTPUT]: 单文件读取/写入/删除结果
 * [POS]: A 域文件 REST API —— 前端手动编辑的单文件内容入口
 * [PROTOCOL]: 这里只暴露 GET/POST；用户手动编辑不写 messages
 */
import { z } from "zod";
import { ownsProject } from "@/server/guard";
import { ownerIdFrom } from "@/server/owner";
import {
  deleteProjectFile,
  FileOperationError,
  FileOperationErrorCode,
  readProjectFile,
  writeProjectFile,
} from "@/server/files";

type Ctx = { params: Promise<{ id: string }> };

const FileContentAction = {
  Write: "write",
  Delete: "delete",
} as const;

const FileContentPostBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal(FileContentAction.Write),
    path: z.string().min(1),
    content: z.string(),
  }).strict(),
  z.object({
    action: z.literal(FileContentAction.Delete),
    path: z.string().min(1),
  }).strict(),
]);

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

async function requireProject(req: Request, ctx: Ctx): Promise<string | Response> {
  const ownerId = ownerIdFrom(req);
  if (!ownerId) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  if (!(await ownsProject(id, ownerId))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return id;
}

export async function GET(req: Request, ctx: Ctx) {
  const projectId = await requireProject(req, ctx);
  if (projectId instanceof Response) return projectId;

  const path = new URL(req.url).searchParams.get("path") ?? "";
  try {
    return Response.json(await readProjectFile(projectId, path));
  } catch (error) {
    return fileError(error);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const projectId = await requireProject(req, ctx);
  if (projectId instanceof Response) return projectId;

  try {
    const body = FileContentPostBodySchema.parse(await req.json());
    if (body.action === FileContentAction.Write) {
      return Response.json(await writeProjectFile(projectId, body.path, body.content));
    }

    await deleteProjectFile(projectId, body.path);
    return Response.json({ ok: true, path: body.path });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "bad request", detail: error.flatten() }, { status: 400 });
    }
    return fileError(error);
  }
}
