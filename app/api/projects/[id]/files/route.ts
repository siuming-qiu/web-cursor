/**
 * [INPUT]: project id + x-owner-id + optional includeContent=1
 * [OUTPUT]: 当前项目 live file summaries，或带 content 的完整文件列表
 * [POS]: A 域文件 REST API —— 前端文件树读取入口
 * [PROTOCOL]: 默认只返回文件列表；小项目工作台可用 includeContent=1 一次性拉全量内容
 */
import { ownsProject } from "@/server/guard";
import { listProjectFileContents, listProjectFiles } from "@/server/files";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const ownerId = req.headers.get("x-owner-id");
  if (!ownerId) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  if (!(await ownsProject(id, ownerId))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const includeContent = new URL(req.url).searchParams.get("includeContent") === "1";
  return Response.json({
    files: includeContent
      ? await listProjectFileContents(id)
      : await listProjectFiles(id),
  });
}
