/**
 * [INPUT]: project id + x-owner-id
 * [OUTPUT]: 当前项目 live file summaries
 * [POS]: A 域文件 REST API —— 前端文件树读取入口
 * [PROTOCOL]: 只返回文件列表，不返回 content；content 走 files/content
 */
import { ownsProject } from "@/server/guard";
import { listProjectFiles } from "@/server/files";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const ownerId = req.headers.get("x-owner-id");
  if (!ownerId) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  if (!(await ownsProject(id, ownerId))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  return Response.json({ files: await listProjectFiles(id) });
}
