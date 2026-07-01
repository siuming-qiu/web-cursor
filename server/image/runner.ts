/**
 * [INPUT]: pending/running image_jobs in DB
 * [OUTPUT]: updated image_jobs/image_runs/project_assets and closed generate_image tool result messages
 * [POS]: A 域生图 runner —— Vercel Cron/本地定时调用的无状态任务处理器
 * [PROTOCOL]: runner 只查本地库；provider 返回 URL/data URL 必须下载并写入 project_assets 后才暴露
 */
import "server-only";
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/server/db";
import { imageJobs, imageRuns } from "@/server/db/schema";
import { appendMessage, listMessages } from "@/server/messages";
import { pollImageProviderJob, providerError, submitImageProviderJob } from "@/server/image/provider";
import { resolveProviderInputImages, saveGeneratedProjectAsset } from "@/server/image/storage";
import {
  ImageAssetSource,
  ImageJobErrorCode,
  ImageJobStatus,
  ImageRunStatus,
  type GenerateImageRunResult,
  type ImageJobError,
} from "@/types/image";
import { ToolName } from "@/types/tool";

const DEFAULT_BATCH_SIZE = 4;
const POLL_INTERVAL_MS = 5_000;
const PROVIDER_TIMEOUT_MS = 5 * 60_000;

type ImageJobRow = typeof imageJobs.$inferSelect;
type ImageRunRow = typeof imageRuns.$inferSelect;

type RunnerJob = {
  job: ImageJobRow;
  run: ImageRunRow;
};

export type ImageRunnerTickResult = {
  processed: number;
  touchedRuns: number;
};

function nowMinus(ms: number) {
  return new Date(Date.now() - ms);
}

function errorOf(code: ImageJobErrorCode, message: string): ImageJobError {
  return { code, message };
}

async function pendingCandidates(limit: number): Promise<RunnerJob[]> {
  return db
    .select({ job: imageJobs, run: imageRuns })
    .from(imageJobs)
    .innerJoin(imageRuns, eq(imageJobs.runId, imageRuns.id))
    .where(and(
      eq(imageJobs.status, ImageJobStatus.Pending),
      isNull(imageJobs.deletedAt),
      isNull(imageRuns.deletedAt),
    ))
    .orderBy(asc(imageJobs.createdAt))
    .limit(limit);
}

async function pollCandidates(limit: number): Promise<RunnerJob[]> {
  return db
    .select({ job: imageJobs, run: imageRuns })
    .from(imageJobs)
    .innerJoin(imageRuns, eq(imageJobs.runId, imageRuns.id))
    .where(and(
      eq(imageJobs.status, ImageJobStatus.Running),
      isNull(imageJobs.deletedAt),
      isNull(imageRuns.deletedAt),
      or(
        isNull(imageJobs.lastPolledAt),
        lt(imageJobs.lastPolledAt, nowMinus(POLL_INTERVAL_MS)),
      ),
    ))
    .orderBy(asc(imageJobs.createdAt))
    .limit(limit);
}

async function claimPending(job: ImageJobRow): Promise<ImageJobRow | null> {
  const now = new Date();
  const [claimed] = await db
    .update(imageJobs)
    .set({
      status: ImageJobStatus.Running,
      startedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(imageJobs.id, job.id),
      eq(imageJobs.status, ImageJobStatus.Pending),
      isNull(imageJobs.deletedAt),
    ))
    .returning();

  if (!claimed) return null;

  await db
    .update(imageRuns)
    .set({
      status: ImageRunStatus.Running,
      startedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(imageRuns.id, claimed.runId),
      inArray(imageRuns.status, [ImageRunStatus.Pending, ImageRunStatus.Running]),
      isNull(imageRuns.deletedAt),
    ));

  return claimed;
}

async function failJob(jobId: string, error: ImageJobError) {
  const now = new Date();
  await db
    .update(imageJobs)
    .set({
      status: ImageJobStatus.Failed,
      error,
      updatedAt: now,
      completedAt: now,
    })
    .where(and(eq(imageJobs.id, jobId), isNull(imageJobs.deletedAt)));
}

async function succeedJob(ctx: {
  run: ImageRunRow;
  job: ImageJobRow;
  bytes: Buffer;
  mimeType: Parameters<typeof saveGeneratedProjectAsset>[0]["mimeType"];
  publicBaseUrl?: string;
}) {
  const result = await saveGeneratedProjectAsset({
    ownerId: ctx.run.ownerId,
    projectId: ctx.run.projectId,
    imageJobId: ctx.job.id,
    bytes: ctx.bytes,
    mimeType: ctx.mimeType,
    publicBaseUrl: ctx.publicBaseUrl,
  });
  const now = new Date();
  await db
    .update(imageJobs)
    .set({
      status: ImageJobStatus.Succeeded,
      result,
      error: null,
      updatedAt: now,
      completedAt: now,
    })
    .where(and(eq(imageJobs.id, ctx.job.id), isNull(imageJobs.deletedAt)));
}

async function submitJob(run: ImageRunRow, job: ImageJobRow, options: { publicBaseUrl?: string }) {
  try {
    const inputImages = await resolveProviderInputImages({
      ownerId: run.ownerId,
      projectId: run.projectId,
      conversationId: run.conversationId,
      inputImages: job.input.inputImages,
    });
    const submitted = await submitImageProviderJob({
      model: job.providerModel,
      input: job.input,
      inputImages,
    });

    if (submitted.status === "completed") {
      await succeedJob({ run, job, bytes: submitted.bytes, mimeType: submitted.mimeType, publicBaseUrl: options.publicBaseUrl });
      return;
    }

    const now = new Date();
    await db
      .update(imageJobs)
      .set({
        providerJobId: submitted.providerJobId,
        lastPolledAt: now,
        updatedAt: now,
      })
      .where(and(eq(imageJobs.id, job.id), eq(imageJobs.status, ImageJobStatus.Running), isNull(imageJobs.deletedAt)));
  } catch (error) {
    await failJob(job.id, providerError(error));
  }
}

async function pollJob(run: ImageRunRow, job: ImageJobRow, options: { publicBaseUrl?: string }) {
  const startedAt = job.startedAt?.getTime() ?? job.createdAt.getTime();
  if (Date.now() - startedAt > PROVIDER_TIMEOUT_MS) {
    await failJob(job.id, errorOf(ImageJobErrorCode.TimedOut, "Image provider timed out."));
    return;
  }
  if (!job.providerJobId) return;

  const result = await pollImageProviderJob({
    model: job.providerModel,
    providerJobId: job.providerJobId,
  });
  const now = new Date();

  if (result.status === "running") {
    await db
      .update(imageJobs)
      .set({ lastPolledAt: now, updatedAt: now })
      .where(and(eq(imageJobs.id, job.id), eq(imageJobs.status, ImageJobStatus.Running), isNull(imageJobs.deletedAt)));
    return;
  }

  if (result.status === "failed") {
    await failJob(job.id, result.error);
    return;
  }

  await succeedJob({ run, job, bytes: result.bytes, mimeType: result.mimeType, publicBaseUrl: options.publicBaseUrl });
}

async function toolResultAlreadyAppended(run: ImageRunRow): Promise<boolean> {
  const rows = await listMessages(run.conversationId);
  return rows.some((row) => {
    if (row.role !== "tool") return false;
    const meta = (row.meta ?? {}) as { toolCallId?: string };
    return meta.toolCallId === run.toolCallId;
  });
}

async function appendTerminalToolResult(run: ImageRunRow, result: GenerateImageRunResult, status: "ok" | "error") {
  if (await toolResultAlreadyAppended(run)) return;
  await appendMessage(run.conversationId, {
    role: "tool",
    content: JSON.stringify({
      status,
      tool: ToolName.GenerateImage,
      runId: run.id,
      result,
    }),
    meta: { toolCallId: run.toolCallId },
  });
}

async function refreshRunStatus(runId: string) {
  const [run] = await db
    .select()
    .from(imageRuns)
    .where(and(eq(imageRuns.id, runId), isNull(imageRuns.deletedAt)))
    .limit(1);
  if (!run) return;

  const jobs = await db
    .select()
    .from(imageJobs)
    .where(and(eq(imageJobs.runId, runId), isNull(imageJobs.deletedAt)))
    .orderBy(asc(imageJobs.createdAt));
  if (jobs.length === 0) return;

  const open = jobs.filter((job) => job.status === ImageJobStatus.Pending || job.status === ImageJobStatus.Running);
  if (open.length > 0) {
    const nextStatus = jobs.some((job) => job.status === ImageJobStatus.Running)
      ? ImageRunStatus.Running
      : ImageRunStatus.Pending;
    await db
      .update(imageRuns)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(and(eq(imageRuns.id, runId), isNull(imageRuns.deletedAt)));
    return;
  }

  const assets = jobs
    .filter((job) => job.status === ImageJobStatus.Succeeded && job.result)
    .map((job) => ({
      assetId: job.result!.assetId,
      imageJobId: job.id,
      label: job.input.label,
      url: job.result!.url,
      mimeType: job.result!.mimeType,
      width: job.result!.width,
      height: job.result!.height,
      source: ImageAssetSource.GeneratedImage,
    }));
  const errors = jobs
    .filter((job) => job.status === ImageJobStatus.Failed && job.error)
    .map((job) => job.error!);
  const result: GenerateImageRunResult = {
    assets,
    ...(errors.length ? { errors } : {}),
  };
  const finalStatus = errors.length ? ImageRunStatus.Failed : ImageRunStatus.Succeeded;
  const now = new Date();

  await db
    .update(imageRuns)
    .set({
      status: finalStatus,
      result,
      error: errors[0] ?? null,
      updatedAt: now,
      completedAt: now,
    })
    .where(and(eq(imageRuns.id, runId), isNull(imageRuns.deletedAt)));

  await appendTerminalToolResult(run, result, errors.length ? "error" : "ok");
}

export async function runImageRunnerTick(
  batchSize = DEFAULT_BATCH_SIZE,
  options: { publicBaseUrl?: string } = {},
): Promise<ImageRunnerTickResult> {
  const touchedRunIds = new Set<string>();
  let processed = 0;

  for (const item of await pendingCandidates(batchSize)) {
    const claimed = await claimPending(item.job);
    if (!claimed) continue;
    processed++;
    touchedRunIds.add(item.run.id);
    await submitJob(item.run, claimed, options);
  }

  for (const item of await pollCandidates(Math.max(0, batchSize - processed))) {
    processed++;
    touchedRunIds.add(item.run.id);
    await pollJob(item.run, item.job, options);
  }

  for (const runId of touchedRunIds) {
    await refreshRunStatus(runId);
  }

  return {
    processed,
    touchedRuns: touchedRunIds.size,
  };
}
