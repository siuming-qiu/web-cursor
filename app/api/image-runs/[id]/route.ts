/**
 * [INPUT]: image run id + x-owner-id
 * [OUTPUT]: run aggregate status and per-image job statuses/results
 * [POS]: A 域生图轮询接口 —— 前端只查本地 image_runs/image_jobs/project_assets 状态
 * [PROTOCOL]: 不代理 provider；ownerId 直接命中 image_runs，跨 owner 返回 404
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { imageJobs, imageRuns } from "@/server/db/schema";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const ownerId = req.headers.get("x-owner-id");
  if (!ownerId) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;

  const [run] = await db
    .select()
    .from(imageRuns)
    .where(and(
      eq(imageRuns.id, id),
      eq(imageRuns.ownerId, ownerId),
      isNull(imageRuns.deletedAt),
    ))
    .limit(1);
  if (!run) return Response.json({ error: "not found" }, { status: 404 });

  const jobs = await db
    .select({
      id: imageJobs.id,
      status: imageJobs.status,
      input: imageJobs.input,
      result: imageJobs.result,
      error: imageJobs.error,
      createdAt: imageJobs.createdAt,
      startedAt: imageJobs.startedAt,
      completedAt: imageJobs.completedAt,
    })
    .from(imageJobs)
    .where(and(eq(imageJobs.runId, run.id), isNull(imageJobs.deletedAt)))
    .orderBy(asc(imageJobs.createdAt));

  return Response.json({
    runId: run.id,
    projectId: run.projectId,
    conversationId: run.conversationId,
    toolCallId: run.toolCallId,
    status: run.status,
    result: run.result,
    error: run.error,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    jobs,
  });
}
