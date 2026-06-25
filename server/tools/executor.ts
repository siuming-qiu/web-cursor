/**
 * [INPUT]: LLM tool_call metadata + ToolExecutionContext
 * [OUTPUT]: structured tool execution result for role=tool messages
 * [POS]: A 域工具执行层 —— 把 LLM 工具调用分发到 server/files.ts
 * [PROTOCOL]: LLM 不传 projectId/ownerId；当前项目由 ToolExecutionContext 绑定
 */
import "server-only";
import { z } from "zod";
import {
  deleteProjectFile,
  FileOperationError,
  FileOperationErrorCode,
  listProjectFiles,
  readProjectFile,
  renameProjectFile,
  writeProjectFile,
} from "@/server/files";
import {
  DeleteFileArgsSchema,
  ListFilesArgsSchema,
  ReadFileArgsSchema,
  RenameFileArgsSchema,
  ReplyArgsSchema,
  WriteFileArgsSchema,
} from "@/types/toolSchema";
import { ToolName, type ToolCallMeta, type ToolName as ToolNameType } from "@/types/tool";

export type ToolExecutionContext = {
  ownerId: string;
  projectId: string;
  conversationId: string;
};

export const ToolExecutionErrorCode = {
  BadArgs: "BAD_ARGS",
  BadPath: FileOperationErrorCode.BadPath,
  NotFound: FileOperationErrorCode.NotFound,
  Conflict: FileOperationErrorCode.Conflict,
  InternalError: FileOperationErrorCode.InternalError,
} as const;

export type ToolExecutionErrorCode =
  typeof ToolExecutionErrorCode[keyof typeof ToolExecutionErrorCode];

export type ToolExecutionResult =
  | { status: "ok"; tool: typeof ToolName.ListFiles; files: { path: string; updatedAt?: string }[] }
  | { status: "ok"; tool: typeof ToolName.ReadFile; path: string; content: string; updatedAt?: string }
  | { status: "ok"; tool: typeof ToolName.WriteFile; path: string; updatedAt?: string }
  | { status: "ok"; tool: typeof ToolName.DeleteFile; path: string }
  | { status: "ok"; tool: typeof ToolName.RenameFile; oldPath: string; newPath: string; updatedAt?: string }
  | { status: "ok"; tool: typeof ToolName.Reply; message: string }
  | {
      status: "error";
      tool: string;
      message: string;
      code: ToolExecutionErrorCode;
    };

function parseArgs(raw: string | undefined): unknown {
  if (!raw?.trim()) return {};
  return JSON.parse(raw);
}

function isKnownTool(name: string): name is ToolNameType {
  return Object.values(ToolName).includes(name as ToolNameType);
}

function errorResult(tool: string, code: Extract<ToolExecutionResult, { status: "error" }>["code"], message: string): ToolExecutionResult {
  return { status: "error", tool, code, message };
}

export async function executeToolCall(
  toolCall: ToolCallMeta,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const tool = toolCall.name;
  if (!isKnownTool(tool)) return errorResult(tool, ToolExecutionErrorCode.BadArgs, `Unknown tool: ${tool}`);

  try {
    switch (tool) {
      case ToolName.ListFiles: {
        ListFilesArgsSchema.parse(parseArgs(toolCall.arguments));
        const files = await listProjectFiles(ctx.projectId);
        return { status: "ok", tool, files };
      }
      case ToolName.ReadFile: {
        const args = ReadFileArgsSchema.parse(parseArgs(toolCall.arguments));
        const file = await readProjectFile(ctx.projectId, args.path);
        return { status: "ok", tool, ...file };
      }
      case ToolName.WriteFile: {
        const args = WriteFileArgsSchema.parse(parseArgs(toolCall.arguments));
        const file = await writeProjectFile(ctx.projectId, args.path, args.content);
        return { status: "ok", tool, path: file.path, updatedAt: file.updatedAt };
      }
      case ToolName.DeleteFile: {
        const args = DeleteFileArgsSchema.parse(parseArgs(toolCall.arguments));
        await deleteProjectFile(ctx.projectId, args.path);
        return { status: "ok", tool, path: args.path };
      }
      case ToolName.RenameFile: {
        const args = RenameFileArgsSchema.parse(parseArgs(toolCall.arguments));
        const file = await renameProjectFile(ctx.projectId, args.oldPath, args.newPath);
        return { status: "ok", tool, oldPath: args.oldPath, newPath: file.path, updatedAt: file.updatedAt };
      }
      case ToolName.Reply: {
        const args = ReplyArgsSchema.parse(parseArgs(toolCall.arguments));
        return { status: "ok", tool, message: args.message };
      }
    }
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return errorResult(tool, ToolExecutionErrorCode.BadArgs, error instanceof Error ? error.message : String(error));
    }
    if (error instanceof FileOperationError) {
      return errorResult(tool, error.code, error.message);
    }
    return errorResult(tool, ToolExecutionErrorCode.InternalError, error instanceof Error ? error.message : String(error));
  }
}
