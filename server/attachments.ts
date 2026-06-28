/**
 * [INPUT]: owner-scoped uploaded attachments and inspect_attachment requests
 * [OUTPUT]: Vercel Blob-backed attachment metadata, data URLs, and inspection results
 * [POS]: A 域 attachment 业务层 —— 上传、归属校验、会话绑定和工具读取的唯一入口
 * [PROTOCOL]: 只支持显式 schema 中声明的 attachment type/mime；不按扩展名或内容猜业务语义
 */
import "server-only";
import { get, put } from "@vercel/blob";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { chatAttachments } from "@/server/db/schema";
import { inspectImageAttachment } from "@/server/vision";
import {
  AttachmentType,
  ImageMimeType,
  type AttachmentSummary,
  type UploadAttachment,
} from "@/types/attachment";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSION: Record<ImageMimeType, string> = {
  [ImageMimeType.Png]: "png",
  [ImageMimeType.Jpeg]: "jpg",
  [ImageMimeType.Webp]: "webp",
};

export const AttachmentErrorCode = {
  BadInput: "BAD_INPUT",
  NotFound: "NOT_FOUND",
  Unsupported: "UNSUPPORTED",
  Storage: "STORAGE",
} as const;

export type AttachmentErrorCode = typeof AttachmentErrorCode[keyof typeof AttachmentErrorCode];

export class AttachmentError extends Error {
  code: AttachmentErrorCode;

  constructor(code: AttachmentErrorCode, message: string) {
    super(message);
    this.name = "AttachmentError";
    this.code = code;
  }
}

type AttachmentRow = typeof chatAttachments.$inferSelect;

function toSummary(row: Pick<AttachmentRow, "id" | "type" | "mimeType" | "sizeBytes">): AttachmentSummary {
  if (row.type !== AttachmentType.Image) {
    throw new AttachmentError(AttachmentErrorCode.Unsupported, `Unsupported attachment type: ${row.type}`);
  }
  if (!Object.values(ImageMimeType).includes(row.mimeType as ImageMimeType)) {
    throw new AttachmentError(AttachmentErrorCode.Unsupported, `Unsupported image mime type: ${row.mimeType}`);
  }
  return {
    id: row.id,
    type: AttachmentType.Image,
    mimeType: row.mimeType as ImageMimeType,
    sizeBytes: row.sizeBytes,
  };
}

function decodeDataUrl(dataUrl: string, mimeType: ImageMimeType): Buffer {
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) {
    throw new AttachmentError(AttachmentErrorCode.BadInput, `dataUrl must start with ${prefix}`);
  }

  const raw = dataUrl.slice(prefix.length);
  if (!raw || /[^A-Za-z0-9+/=]/.test(raw)) {
    throw new AttachmentError(AttachmentErrorCode.BadInput, "dataUrl contains invalid base64 image data.");
  }

  const buffer = Buffer.from(raw, "base64");
  if (buffer.length === 0) {
    throw new AttachmentError(AttachmentErrorCode.BadInput, "Image attachment is empty.");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new AttachmentError(AttachmentErrorCode.BadInput, `Image attachment exceeds ${MAX_IMAGE_BYTES} bytes.`);
  }
  return buffer;
}

export async function uploadAttachment(ownerId: string, input: UploadAttachment): Promise<AttachmentSummary> {
  if (input.type !== AttachmentType.Image) {
    throw new AttachmentError(AttachmentErrorCode.Unsupported, `Unsupported attachment type: ${input.type}`);
  }

  const id = crypto.randomUUID();
  const buffer = decodeDataUrl(input.dataUrl, input.mimeType);
  const blobPath = `attachments/${ownerId}/${id}.${MIME_EXTENSION[input.mimeType]}`;

  try {
    const blob = await put(blobPath, buffer, {
      access: "private",
      addRandomSuffix: false,
      contentType: input.mimeType,
    });

    const [row] = await db.insert(chatAttachments).values({
      id,
      ownerId,
      projectId: input.projectId,
      type: input.type,
      mimeType: input.mimeType,
      blobPath,
      blobUrl: blob.url,
      sizeBytes: buffer.length,
      originalName: input.fileName,
    }).returning({
      id: chatAttachments.id,
      type: chatAttachments.type,
      mimeType: chatAttachments.mimeType,
      sizeBytes: chatAttachments.sizeBytes,
    });

    return toSummary(row);
  } catch (error) {
    if (error instanceof AttachmentError) throw error;
    throw new AttachmentError(
      AttachmentErrorCode.Storage,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function attachToConversation({
  ownerId,
  conversationId,
  projectId,
  attachmentIds,
}: {
  ownerId: string;
  conversationId: string;
  projectId: string;
  attachmentIds: string[];
}): Promise<AttachmentSummary[]> {
  if (attachmentIds.length === 0) return [];

  const rows = await db
    .select({
      id: chatAttachments.id,
      type: chatAttachments.type,
      mimeType: chatAttachments.mimeType,
      sizeBytes: chatAttachments.sizeBytes,
    })
    .from(chatAttachments)
    .where(and(
      inArray(chatAttachments.id, attachmentIds),
      eq(chatAttachments.ownerId, ownerId),
      isNull(chatAttachments.deletedAt),
    ));

  if (rows.length !== attachmentIds.length) {
    throw new AttachmentError(AttachmentErrorCode.NotFound, "One or more attachments were not found.");
  }

  await db
    .update(chatAttachments)
    .set({ projectId, conversationId })
    .where(and(
      inArray(chatAttachments.id, attachmentIds),
      eq(chatAttachments.ownerId, ownerId),
      isNull(chatAttachments.deletedAt),
    ));

  return rows.map(toSummary);
}

async function getConversationAttachment(ctx: {
  ownerId: string;
  conversationId: string;
  attachmentId: string;
}): Promise<AttachmentRow> {
  const [row] = await db
    .select()
    .from(chatAttachments)
    .where(and(
      eq(chatAttachments.id, ctx.attachmentId),
      eq(chatAttachments.ownerId, ctx.ownerId),
      eq(chatAttachments.conversationId, ctx.conversationId),
      isNull(chatAttachments.deletedAt),
    ))
    .limit(1);

  if (!row) throw new AttachmentError(AttachmentErrorCode.NotFound, `Attachment not found: ${ctx.attachmentId}`);
  return row;
}

async function readAttachmentDataUrl(row: AttachmentRow): Promise<string> {
  const result = await get(row.blobPath, { access: "private" });
  if (!result) {
    throw new AttachmentError(AttachmentErrorCode.Storage, "Blob read returned no result.");
  }
  if (result.statusCode !== 200) {
    throw new AttachmentError(AttachmentErrorCode.Storage, `Blob read failed with status ${result.statusCode}.`);
  }
  if (!result.stream) {
    throw new AttachmentError(AttachmentErrorCode.Storage, "Blob read returned no stream.");
  }

  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const base64 = Buffer.concat(chunks).toString("base64");
  return `data:${row.mimeType};base64,${base64}`;
}

export async function inspectAttachment(ctx: {
  ownerId: string;
  conversationId: string;
  attachmentId: string;
}) {
  const row = await getConversationAttachment(ctx);
  if (row.type !== AttachmentType.Image) {
    throw new AttachmentError(AttachmentErrorCode.Unsupported, `Unsupported attachment type: ${row.type}`);
  }

  const dataUrl = await readAttachmentDataUrl(row);
  const observations = await inspectImageAttachment(dataUrl);

  return {
    attachmentId: row.id,
    attachmentType: AttachmentType.Image,
    mimeType: row.mimeType,
    observations,
  };
}
