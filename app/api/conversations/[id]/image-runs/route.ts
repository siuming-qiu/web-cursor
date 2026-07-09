/**
 * [INPUT]: conversation id + x-owner-id
 * [OUTPUT]: image runs and jobs for UI recovery
 * [POS]: A 域会话生图任务查询接口 —— messages 保持 transcript，UI 单独恢复异步任务状态
 * [PROTOCOL]: 只读本地 image_runs/image_jobs；不代理 provider，不写 messages
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { ownsConversation } from "@/server/guard";
import { ownerIdFrom } from "@/server/owner";
import { db } from "@/server/db";
import { imageJobs, imageRuns } from "@/server/db/schema";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const ownerId = ownerIdFrom(req);
  if (!ownerId) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!(await ownsConversation(id, ownerId))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const runs = await db
    .select({
      runId: imageRuns.id,
      toolCallId: imageRuns.toolCallId,
      status: imageRuns.status,
      result: imageRuns.result,
      error: imageRuns.error,
      createdAt: imageRuns.createdAt,
    })
    .from(imageRuns)
    .where(and(eq(imageRuns.conversationId, id), isNull(imageRuns.deletedAt)))
    .orderBy(asc(imageRuns.createdAt));

  if (!runs.length) return Response.json([]);

  const jobs = await db
    .select({
      id: imageJobs.id,
      runId: imageJobs.runId,
      status: imageJobs.status,
      input: imageJobs.input,
      result: imageJobs.result,
      error: imageJobs.error,
      createdAt: imageJobs.createdAt,
    })
    .from(imageJobs)
    .where(and(inArray(imageJobs.runId, runs.map((run) => run.runId)), isNull(imageJobs.deletedAt)))
    .orderBy(asc(imageJobs.createdAt));

  const jobsByRunId = new Map<string, typeof jobs>();
  for (const job of jobs) {
    jobsByRunId.set(job.runId, [...(jobsByRunId.get(job.runId) ?? []), job]);
  }

  return Response.json(runs.map((run) => ({
    ...run,
    jobs: jobsByRunId.get(run.runId) ?? [],
  })));
}
