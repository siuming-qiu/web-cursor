/**
 * [INPUT]: GET 取项目详情；POST 改名 / 软删（只用 get/post，不用 PATCH/DELETE）
 * [OUTPUT]: 项目 + 它的会话线索 / 更新后的项目
 * [POS]: A 域项目 CRUD（读 + 更新）。代码不在这（本期"当前代码"从 messages 取）
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { conversations, projects } from "@/server/db/schema";
import { listProjectFiles } from "@/server/files";

type Ctx = { params: Promise<{ id: string }> };

// 项目详情 + 会话线索 + 文件列表（文件内容按需另取）
export async function GET(req: Request, ctx: Ctx) {
  const ownerId = req.headers.get("x-owner-id");
  if (!ownerId) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;

  const [project] = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) return Response.json({ error: "not found" }, { status: 404 });

  const convs = await db.select().from(conversations)
    .where(and(eq(conversations.projectId, id), isNull(conversations.deletedAt)))
    .orderBy(asc(conversations.createdAt));

  const files = await listProjectFiles(id);

  return Response.json({ ...project, conversations: convs, files });
}

// 更新项目：{ title } 改名；{ deleted: true } 软删。owner 进 where，改不到即 404。
const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  deleted: z.boolean().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const ownerId = req.headers.get("x-owner-id");
  if (!ownerId) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  try {
    const body = UpdateSchema.parse(await req.json());
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.deleted) patch.deletedAt = new Date();   // 软删项目即可：其会话/消息经 project 归属判定不可达

    const [row] = await db.update(projects).set(patch)
      .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId), isNull(projects.deletedAt)))
      .returning();
    if (!row) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(row);
  } catch (e) {
    return Response.json({ error: "bad request", detail: String(e) }, { status: 400 });
  }
}
