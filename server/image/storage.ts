/**
 * [INPUT]: owner/project/conversation scoped image refs and generated image bytes
 * [OUTPUT]: provider-ready input image refs and persisted project asset metadata
 * [POS]: A 域生图存储层 —— runner 读取受控图片引用、写入生成资产
 * [PROTOCOL]: 不接受任意 URL/base64；只解析 attachmentId/project_asset；未知 MIME 直接报错
 */
import "server-only";
import { get, put } from "@vercel/blob";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { chatAttachments, projectAssets } from "@/server/db/schema";
import {
  GeneratedImageMimeType,
  ImageAssetSource,
  type GenerateImageInputImage,
  GenerateImageInputImageSource,
  type GenerateImageJobResult,
  type GeneratedImageMimeType as GeneratedImageMimeTypeValue,
} from "@/types/image";
import { SITE_URL } from "@/lib/site";

export type ProviderInputImage = {
  dataUrl: string;
  publicUrl?: string;
};

type ImageDimensions = {
  width: number;
  height: number;
};

const MIME_EXTENSION: Record<GeneratedImageMimeTypeValue, string> = {
  [GeneratedImageMimeType.Png]: "png",
  [GeneratedImageMimeType.Jpeg]: "jpg",
  [GeneratedImageMimeType.Webp]: "webp",
};

function isGeneratedImageMimeType(value: string): value is GeneratedImageMimeTypeValue {
  return Object.values(GeneratedImageMimeType).includes(value as GeneratedImageMimeTypeValue);
}

async function readBlobDataUrl(blobPath: string, mimeType: string): Promise<string> {
  const result = await get(blobPath, { access: "private" }) as {
    statusCode?: number;
    stream?: ReadableStream<Uint8Array>;
  } | null;
  if (!result?.stream) throw new Error(`Blob read failed: ${blobPath}`);
  if (result.statusCode !== undefined && result.statusCode !== 200) {
    throw new Error(`Blob read HTTP ${result.statusCode}: ${blobPath}`);
  }

  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  return `data:${mimeType};base64,${Buffer.concat(chunks).toString("base64")}`;
}

async function resolveAttachmentImage(ctx: {
  ownerId: string;
  projectId: string;
  conversationId: string;
  attachmentId: string;
}): Promise<ProviderInputImage> {
  const [row] = await db
    .select()
    .from(chatAttachments)
    .where(and(
      eq(chatAttachments.id, ctx.attachmentId),
      eq(chatAttachments.ownerId, ctx.ownerId),
      eq(chatAttachments.projectId, ctx.projectId),
      eq(chatAttachments.conversationId, ctx.conversationId),
      isNull(chatAttachments.deletedAt),
    ))
    .limit(1);

  if (!row) throw new Error(`Attachment not found: ${ctx.attachmentId}`);
  if (!isGeneratedImageMimeType(row.mimeType)) {
    throw new Error(`Unsupported attachment image mime type: ${row.mimeType}`);
  }

  return { dataUrl: await readBlobDataUrl(row.blobPath, row.mimeType) };
}

async function resolveProjectAssetImage(ctx: {
  ownerId: string;
  projectId: string;
  assetId: string;
}): Promise<ProviderInputImage> {
  const [row] = await db
    .select()
    .from(projectAssets)
    .where(and(
      eq(projectAssets.id, ctx.assetId),
      eq(projectAssets.ownerId, ctx.ownerId),
      eq(projectAssets.projectId, ctx.projectId),
      isNull(projectAssets.deletedAt),
    ))
    .limit(1);

  if (!row) throw new Error(`Project asset not found: ${ctx.assetId}`);
  if (!isGeneratedImageMimeType(row.mimeType)) {
    throw new Error(`Unsupported project asset image mime type: ${row.mimeType}`);
  }

  return {
    dataUrl: await readBlobDataUrl(row.blobPath, row.mimeType),
    publicUrl: row.publicUrl,
  };
}

export async function resolveProviderInputImages(ctx: {
  ownerId: string;
  projectId: string;
  conversationId: string;
  inputImages?: GenerateImageInputImage[];
}): Promise<ProviderInputImage[]> {
  const refs = ctx.inputImages ?? [];
  const out: ProviderInputImage[] = [];

  for (const ref of refs) {
    if (ref.source === GenerateImageInputImageSource.Attachment) {
      out.push(await resolveAttachmentImage({ ...ctx, attachmentId: ref.attachmentId }));
      continue;
    }
    if (ref.source === GenerateImageInputImageSource.ProjectAsset) {
      out.push(await resolveProjectAssetImage({ ...ctx, assetId: ref.assetId }));
      continue;
    }
    const unreachable: never = ref;
    throw new Error(`Unsupported input image source: ${JSON.stringify(unreachable)}`);
  }

  return out;
}

function imageDimensions(buffer: Buffer, mimeType: GeneratedImageMimeTypeValue): ImageDimensions {
  if (mimeType === GeneratedImageMimeType.Png) {
    if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
      throw new Error("Invalid PNG image bytes.");
    }
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (mimeType === GeneratedImageMimeType.Jpeg) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) throw new Error("Invalid JPEG marker.");
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
    throw new Error("JPEG dimensions not found.");
  }

  if (mimeType === GeneratedImageMimeType.Webp) {
    if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
      throw new Error("Invalid WebP image bytes.");
    }
    if (buffer.toString("ascii", 12, 16) === "VP8X") {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    throw new Error("Unsupported WebP dimensions chunk.");
  }

  throw new Error(`Unsupported generated image mime type: ${mimeType}`);
}

export async function saveGeneratedProjectAsset(ctx: {
  ownerId: string;
  projectId: string;
  imageJobId: string;
  mimeType: GeneratedImageMimeTypeValue;
  bytes: Buffer;
  publicBaseUrl?: string;
}): Promise<GenerateImageJobResult> {
  const dimensions = imageDimensions(ctx.bytes, ctx.mimeType);
  const assetId = crypto.randomUUID();
  const blobPath = `project-assets/${ctx.ownerId}/${ctx.projectId}/${assetId}.${MIME_EXTENSION[ctx.mimeType]}`;
  const blob = await put(blobPath, ctx.bytes, {
    access: "private",
    addRandomSuffix: false,
    contentType: ctx.mimeType,
  });
  void blob;
  const assetUrl = new URL(`/api/project-assets/${assetId}`, ctx.publicBaseUrl ?? SITE_URL).toString();

  const [row] = await db.insert(projectAssets).values({
    id: assetId,
    ownerId: ctx.ownerId,
    projectId: ctx.projectId,
    imageJobId: ctx.imageJobId,
    source: ImageAssetSource.GeneratedImage,
    mimeType: ctx.mimeType,
    blobPath,
    publicUrl: assetUrl,
    width: dimensions.width,
    height: dimensions.height,
    sizeBytes: ctx.bytes.length,
  }).returning({
    id: projectAssets.id,
    publicUrl: projectAssets.publicUrl,
    mimeType: projectAssets.mimeType,
    width: projectAssets.width,
    height: projectAssets.height,
  });

  return {
    assetId: row.id,
    url: row.publicUrl,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
  };
}
