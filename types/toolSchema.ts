import { z } from "zod";
import { ToolResultType } from "./tool";

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

export const InspectAttachmentArgsSchema = z.object({
  attachmentId: z.string().uuid(),
}).strict();

export const ReplyArgsSchema = z.object({
  message: z.string().min(1),
}).strict();

export const ToolResultSchema = z.discriminatedUnion("type", [
  z.object({
    status: z.literal("ok"),
    type: z.literal(ToolResultType.RenderOk),
    durationMs: z.number().optional(),
  }),
  z.object({
    status: z.literal("error"),
    type: z.literal(ToolResultType.CompileError),
    message: z.string(),
  }),
  z.object({
    status: z.literal("error"),
    type: z.literal(ToolResultType.RuntimeError),
    message: z.string(),
    stack: z.string().optional(),
  }),
  z.object({
    status: z.literal("error"),
    type: z.literal(ToolResultType.ToolInterrupted),
    message: z.string(),
  }),
]);
