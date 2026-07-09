import { z } from "zod";
import { GenerateImageInputImageSource, ImageAspectRatio } from "./image";
import { ToolCommand, ToolResultType } from "./tool";

export const ListFilesArgsSchema = z.object({}).strict();

export const ReadFileArgsSchema = z.object({
  path: z.string().min(1),
}).strict();

export const WriteFileArgsSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
}).strict();

export const DeleteFileArgsSchema = z.object({
  path: z.string().min(1),
}).strict();

export const RenameFileArgsSchema = z.object({
  oldPath: z.string().min(1),
  newPath: z.string().min(1),
}).strict();

export const RunPreviewArgsSchema = z.object({}).strict();

export const InspectAttachmentArgsSchema = z.object({
  attachmentId: z.string().uuid(),
}).strict();

export const InspectFigmaDesignArgsSchema = z.object({
  figmaUrl: z.string().url(),
  maxDepth: z.number().int().min(1).max(8).optional(),
  includeAssets: z.boolean(),
}).strict();

export const GenerateImageItemSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  prompt: z.string().min(1).max(4000),
  aspectRatio: z.enum([
    ImageAspectRatio.Square,
    ImageAspectRatio.FourThree,
    ImageAspectRatio.ThreeTwo,
    ImageAspectRatio.SixteenNine,
    ImageAspectRatio.TwentyOneNine,
    ImageAspectRatio.NineSixteen,
  ]).optional(),
  inputImages: z.array(z.discriminatedUnion("source", [
    z.object({
      source: z.literal(GenerateImageInputImageSource.Attachment),
      attachmentId: z.string().uuid(),
    }).strict(),
    z.object({
      source: z.literal(GenerateImageInputImageSource.ProjectAsset),
      assetId: z.string().uuid(),
    }).strict(),
  ])).max(4).optional(),
}).strict();

export const GenerateImageArgsSchema = z.object({
  images: z.array(GenerateImageItemSchema).min(1).max(4),
}).strict();

export const ToolResultSchema = z.discriminatedUnion("type", [
  z.object({
    status: z.literal("ok"),
    type: z.literal(ToolResultType.ServerReady),
    port: z.number().int(),
    url: z.string().url(),
    rawLog: z.string().optional(),
    durationMs: z.number().optional(),
  }).strict(),
  z.object({
    status: z.literal("error"),
    type: z.literal(ToolResultType.InstallError),
    command: z.literal(ToolCommand.Install),
    exitCode: z.number().int(),
    message: z.string(),
    rawLog: z.string(),
  }).strict(),
  z.object({
    status: z.literal("error"),
    type: z.literal(ToolResultType.DevServerError),
    command: z.literal(ToolCommand.DevServer),
    exitCode: z.number().int().nullable(),
    message: z.string(),
    rawLog: z.string(),
  }).strict(),
  z.object({
    status: z.literal("error"),
    type: z.literal(ToolResultType.BrowserRuntimeError),
    message: z.string(),
    stack: z.string().optional(),
    rawLog: z.string().optional(),
  }).strict(),
  z.object({
    status: z.literal("error"),
    type: z.literal(ToolResultType.ToolInterrupted),
    message: z.string(),
  }).strict(),
]);
