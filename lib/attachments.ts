/**
 * [INPUT]: browser File objects selected by the user
 * [OUTPUT]: uploaded attachment ids and local preview metadata for chat turns
 * [POS]: B 域附件上传门面 —— 图片先传 /api/attachments，再由 /api/chat 引用 attachmentId
 * [PROTOCOL]: 只接受后端契约声明的 image/png、image/jpeg、image/webp；不按扩展名猜 MIME
 */
"use client";

import { req } from "@/lib/api";
import {
  AttachmentType,
  ImageMimeType,
  type AttachmentSummary,
  type ImageMimeType as ImageMimeTypeValue,
} from "@/types/attachment";
import type { SendAttachment } from "@/lib/types";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES: readonly ImageMimeTypeValue[] = [
  ImageMimeType.Png,
  ImageMimeType.Jpeg,
  ImageMimeType.Webp,
];

export type PendingAttachment = {
  id: string;
  file: File;
  name: string;
  mimeType: ImageMimeTypeValue;
  sizeBytes: number;
  previewUrl: string;
};

type UploadResponse = AttachmentSummary;

export function createPendingAttachment(file: File): PendingAttachment {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type as ImageMimeTypeValue)) {
    throw new Error("只支持 PNG、JPEG、WebP 图片。");
  }
  if (file.size <= 0) {
    throw new Error("图片文件为空。");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("图片不能超过 5MB。");
  }

  return {
    id: crypto.randomUUID(),
    file,
    name: file.name || "未命名图片",
    mimeType: file.type as ImageMimeTypeValue,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
  };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败。"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("读取图片失败。"));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadPendingAttachment(
  attachment: PendingAttachment,
  projectId?: string,
): Promise<SendAttachment> {
  const uploaded = await req<UploadResponse>("POST", "/api/attachments", {
    type: AttachmentType.Image,
    mimeType: attachment.mimeType,
    dataUrl: await readAsDataUrl(attachment.file),
    fileName: attachment.name,
    projectId,
  });

  return {
    id: uploaded.id,
    name: attachment.name,
    type: uploaded.type,
    mimeType: uploaded.mimeType,
    sizeBytes: uploaded.sizeBytes,
    previewUrl: attachment.previewUrl,
  };
}
