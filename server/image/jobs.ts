/**
 * [INPUT]: owner/project/conversation/toolCallId context + generate_image args
 * [OUTPUT]: persisted image run with one image job per requested image
 * [POS]: A 域异步生图任务创建层 —— 只创建 pending run/jobs，不调用 provider
 * [PROTOCOL]: run 绑定 toolCallId；单张图 prompt/status 只存 image_jobs，image_runs 只管聚合与闭合
 */
import "server-only";
import { db } from "@/server/db";
import { imageJobs, imageRuns } from "@/server/db/schema";
import {
  ImageJobStatus,
  ImageProvider,
  ImageProviderModel,
  ImageRunStatus,
  type ImageProviderModel as ImageProviderModelValue,
  type GenerateImageInput,
  type PendingImageJob,
} from "@/types/image";
import { ToolName } from "@/types/tool";

export type CreateImageRunInput = {
  ownerId: string;
  projectId: string;
  conversationId: string;
  toolCallId: string;
  input: GenerateImageInput;
};

export type PendingImageRun = {
  runId: string;
  jobs: PendingImageJob[];
};

export function configuredImageProviderModel(): ImageProviderModelValue {
  const model = process.env.YUNWU_IMAGE_MODEL ?? ImageProviderModel.YunwuGemini31FlashImagePreview;
  if (!Object.values(ImageProviderModel).includes(model as ImageProviderModelValue)) {
    throw new Error(`Unsupported YUNWU_IMAGE_MODEL: ${model}`);
  }
  return model as ImageProviderModelValue;
}

export async function createPendingImageRun(input: CreateImageRunInput): Promise<PendingImageRun> {
  const providerModel = configuredImageProviderModel();

  return db.transaction(async (tx) => {
    const [run] = await tx.insert(imageRuns).values({
      ownerId: input.ownerId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      toolCallId: input.toolCallId,
      status: ImageRunStatus.Pending,
    }).returning({ id: imageRuns.id });

    const rows = await tx.insert(imageJobs).values(input.input.images.map((image) => ({
      runId: run.id,
      status: ImageJobStatus.Pending,
      input: image,
      provider: ImageProvider.Yunwu,
      providerModel,
    }))).returning({
      id: imageJobs.id,
      input: imageJobs.input,
    });

    return {
      runId: run.id,
      jobs: rows.map((row) => ({
        jobId: row.id,
        label: row.input.label,
        prompt: row.input.prompt,
        aspectRatio: row.input.aspectRatio,
        inputImages: row.input.inputImages,
      })),
    };
  });
}

export function pendingImageRunResult(run: PendingImageRun) {
  return {
    status: "pending" as const,
    tool: ToolName.GenerateImage,
    runId: run.runId,
    jobs: run.jobs,
    message: "Image generation started.",
  };
}
