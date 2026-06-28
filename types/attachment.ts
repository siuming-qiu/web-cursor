import { z } from "zod";

export const AttachmentType = {
  Image: "image",
} as const;

export type AttachmentType = typeof AttachmentType[keyof typeof AttachmentType];

export const ImageMimeType = {
  Png: "image/png",
  Jpeg: "image/jpeg",
  Webp: "image/webp",
} as const;

export type ImageMimeType = typeof ImageMimeType[keyof typeof ImageMimeType];

export const ChatAttachmentRefSchema = z.object({
  id: z.string().uuid(),
}).strict();

export const UploadAttachmentSchema = z.object({
  type: z.literal(AttachmentType.Image),
  mimeType: z.enum([ImageMimeType.Png, ImageMimeType.Jpeg, ImageMimeType.Webp]),
  dataUrl: z.string().min(1),
  fileName: z.string().trim().min(1).max(160).optional(),
  projectId: z.string().uuid().optional(),
}).strict();

export type ChatAttachmentRef = z.infer<typeof ChatAttachmentRefSchema>;
export type UploadAttachment = z.infer<typeof UploadAttachmentSchema>;

export type AttachmentSummary = {
  id: string;
  type: typeof AttachmentType.Image;
  mimeType: ImageMimeType;
  sizeBytes: number;
};
