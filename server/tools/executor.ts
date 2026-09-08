/**
 * [INPUT]: LLM tool_call metadata + trusted project/owner/runtime context + optional AgentRun transaction context
 * [OUTPUT]: structured repository、attachment、Figma、image-run 或 Child-control result
 * [POS]: A 域工具执行层 —— Parent/Child Host 共用的服务端工具分发器
 * [PROTOCOL]: LLM 不传 projectId/ownerId/run identity；Child 控制工具必须由可信编排层显式绑定 adapter
 */
import "server-only";
import { z } from "zod";
import { inspectAttachment, AttachmentError, AttachmentErrorCode } from "@/server/attachments";
import { inspectFigmaDesign } from "@/server/figma/inspect";
import { FigmaInspectError, type FigmaDesignContext } from "@/server/figma/types";
import { createPendingImageRun, pendingImageRunResult } from "@/server/image/jobs";
import {
  deleteProjectFile,
  FileOperationError,
  listProjectFilesSnapshot,
  readProjectFile,
  renameProjectFile,
  searchProjectFiles,
  type DatabaseFileTransaction,
  type ProjectTextSearchResult,
  writeProjectFile,
} from "@/server/files";
import {
  DeleteFileArgsSchema,
  FollowupTaskArgsSchema,
  GenerateImageArgsSchema,
  GitCommitArgsSchema,
  GitCurrentBranchArgsSchema,
  GitLogArgsSchema,
  GitStageArgsSchema,
  GitStatusArgsSchema,
  GitUnstageArgsSchema,
  InspectAttachmentArgsSchema,
  InspectFigmaDesignArgsSchema,
  InterruptAgentArgsSchema,
  ListFilesArgsSchema,
  ReadFileArgsSchema,
  RenameFileArgsSchema,
  RunPreviewArgsSchema,
  SendMessageArgsSchema,
  SearchTextArgsSchema,
  SpawnAgentArgsSchema,
  WaitAgentArgsSchema,
  WriteFileArgsSchema,
} from "@/types/toolSchema";
import { ToolName, type ToolCallMeta, type ToolName as ToolNameType } from "@/types/tool";
import {
  ToolExecutionErrorCode,
  type FollowupTaskResult,
  type InterruptAgentResult,
  type SendMessageResult,
  type SpawnAgentResult,
  type ToolExecutionErrorCode as ToolExecutionErrorCodeValue,
  type WaitAgentResult,
} from "@/types/toolResult";

export { ToolExecutionErrorCode };

export type ToolExecutionContext = {
  ownerId: string;
  projectId: string;
  conversationId?: string;
  signal?: AbortSignal;
  subagentControl?: SubagentToolControl;
  databaseWriter?: DatabaseFileTransaction;
  agentRun?: {
    id: string;
    invocationId: string;
  };
};

type SpawnAgentArgs = z.infer<typeof SpawnAgentArgsSchema>;
type WaitAgentArgs = z.infer<typeof WaitAgentArgsSchema>;
type SendMessageArgs = z.infer<typeof SendMessageArgsSchema>;
type FollowupTaskArgs = z.infer<typeof FollowupTaskArgsSchema>;
type InterruptAgentArgs = z.infer<typeof InterruptAgentArgsSchema>;

export type SubagentToolControl = Readonly<{
  spawn(args: SpawnAgentArgs): ToolExecutionResult;
  wait(args: WaitAgentArgs, signal?: AbortSignal): Promise<ToolExecutionResult>;
  sendMessage(args: SendMessageArgs): ToolExecutionResult;
  followupTask(args: FollowupTaskArgs): ToolExecutionResult;
  interrupt(args: InterruptAgentArgs): ToolExecutionResult;
}>;

export type ToolExecutionResult =
  | { status: "ok"; tool: typeof ToolName.ListFiles; revision: number; files: { path: string; updatedAt?: string }[] }
  | ({ status: "ok"; tool: typeof ToolName.SearchText; query: string } & ProjectTextSearchResult)
  | { status: "ok"; tool: typeof ToolName.ReadFile; revision: number; path: string; content: string; updatedAt?: string }
  | { status: "ok"; tool: typeof ToolName.WriteFile; revision: number; path: string; updatedAt?: string }
  | { status: "ok"; tool: typeof ToolName.DeleteFile; revision: number; path: string }
  | { status: "ok"; tool: typeof ToolName.RenameFile; revision: number; oldPath: string; newPath: string; updatedAt?: string }
  | {
      status: "ok";
      tool: typeof ToolName.InspectAttachment;
      attachmentId: string;
      attachmentType: "image";
      mimeType: string;
      observations: string;
    }
  | FigmaDesignContext
  | ReturnType<typeof pendingImageRunResult>
  | SpawnAgentResult
  | WaitAgentResult
  | SendMessageResult
  | FollowupTaskResult
  | InterruptAgentResult
  | {
      status: "error";
      tool: string;
      message: string;
      code: ToolExecutionErrorCodeValue;
    };

function parseArgs(raw: string): unknown {
  return JSON.parse(raw);
}

function isKnownTool(name: string): name is ToolNameType {
  return Object.values(ToolName).includes(name as ToolNameType);
}

function errorResult(tool: string, code: Extract<ToolExecutionResult, { status: "error" }>["code"], message: string): ToolExecutionResult {
  return { status: "error", tool, code, message };
}

function requireConversationId(
  tool: string,
  context: ToolExecutionContext,
): string | ToolExecutionResult {
  return context.conversationId ?? errorResult(
    tool,
    ToolExecutionErrorCode.Unsupported,
    `${tool} requires a Conversation context.`,
  );
}

function requireSubagentControl(
  tool: string,
  context: ToolExecutionContext,
): SubagentToolControl | ToolExecutionResult {
  return context.subagentControl ?? errorResult(
    tool,
    ToolExecutionErrorCode.Unsupported,
    `${tool} requires an Agent task runtime.`,
  );
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
        const snapshot = await listProjectFilesSnapshot(ctx.projectId);
        return { status: "ok", tool, ...snapshot };
      }
      case ToolName.SearchText: {
        const args = SearchTextArgsSchema.parse(parseArgs(toolCall.arguments));
        const result = await searchProjectFiles(ctx.projectId, args.query);
        return { status: "ok", tool, query: args.query, ...result };
      }
      case ToolName.ReadFile: {
        const args = ReadFileArgsSchema.parse(parseArgs(toolCall.arguments));
        const file = await readProjectFile(ctx.projectId, args.path);
        return { status: "ok", tool, ...file };
      }
      case ToolName.WriteFile: {
        const args = WriteFileArgsSchema.parse(parseArgs(toolCall.arguments));
        const file = await writeProjectFile(
          ctx.projectId,
          args.path,
          args.content,
          args.expectedRevision,
          ctx.databaseWriter,
        );
        return { status: "ok", tool, path: file.path, updatedAt: file.updatedAt, revision: file.revision };
      }
      case ToolName.DeleteFile: {
        const args = DeleteFileArgsSchema.parse(parseArgs(toolCall.arguments));
        const result = await deleteProjectFile(
          ctx.projectId,
          args.path,
          args.expectedRevision,
          ctx.databaseWriter,
        );
        return { status: "ok", tool, path: args.path, revision: result.revision };
      }
      case ToolName.RenameFile: {
        const args = RenameFileArgsSchema.parse(parseArgs(toolCall.arguments));
        const file = await renameProjectFile(
          ctx.projectId,
          args.oldPath,
          args.newPath,
          args.expectedRevision,
          ctx.databaseWriter,
        );
        return {
          status: "ok",
          tool,
          oldPath: args.oldPath,
          newPath: file.path,
          updatedAt: file.updatedAt,
          revision: file.revision,
        };
      }
      case ToolName.GitStatus: {
        GitStatusArgsSchema.parse(parseArgs(toolCall.arguments));
        return errorResult(tool, ToolExecutionErrorCode.Unsupported, "git_status must be executed by a Browser Git client.");
      }
      case ToolName.GitStage: {
        GitStageArgsSchema.parse(parseArgs(toolCall.arguments));
        return errorResult(tool, ToolExecutionErrorCode.Unsupported, "git_stage must be executed by a Browser Git client.");
      }
      case ToolName.GitUnstage: {
        GitUnstageArgsSchema.parse(parseArgs(toolCall.arguments));
        return errorResult(tool, ToolExecutionErrorCode.Unsupported, "git_unstage must be executed by a Browser Git client.");
      }
      case ToolName.GitCommit: {
        GitCommitArgsSchema.parse(parseArgs(toolCall.arguments));
        return errorResult(tool, ToolExecutionErrorCode.Unsupported, "git_commit must be executed by a Browser Git client.");
      }
      case ToolName.GitLog: {
        GitLogArgsSchema.parse(parseArgs(toolCall.arguments));
        return errorResult(tool, ToolExecutionErrorCode.Unsupported, "git_log must be executed by a Browser Git client.");
      }
      case ToolName.GitCurrentBranch: {
        GitCurrentBranchArgsSchema.parse(parseArgs(toolCall.arguments));
        return errorResult(tool, ToolExecutionErrorCode.Unsupported, "git_current_branch must be executed by a Browser Git client.");
      }
      case ToolName.RunPreview: {
        RunPreviewArgsSchema.parse(parseArgs(toolCall.arguments));
        return errorResult(tool, ToolExecutionErrorCode.Unsupported, "run_preview must be executed by the browser client.");
      }
      case ToolName.InspectAttachment: {
        const args = InspectAttachmentArgsSchema.parse(parseArgs(toolCall.arguments));
        const conversationId = requireConversationId(tool, ctx);
        if (typeof conversationId !== "string") return conversationId;
        const result = await inspectAttachment({
          ownerId: ctx.ownerId,
          conversationId,
          attachmentId: args.attachmentId,
        });
        return { status: "ok", tool, ...result };
      }
      case ToolName.InspectFigmaDesign: {
        const args = InspectFigmaDesignArgsSchema.parse(parseArgs(toolCall.arguments));
        return inspectFigmaDesign({
          ownerId: ctx.ownerId,
          figmaUrl: args.figmaUrl,
          maxDepth: args.maxDepth,
          includeAssets: args.includeAssets,
        });
      }
      case ToolName.GenerateImage: {
        const args = GenerateImageArgsSchema.parse(parseArgs(toolCall.arguments));
        const conversationId = requireConversationId(tool, ctx);
        if (typeof conversationId !== "string") return conversationId;
        const run = await createPendingImageRun({
          ownerId: ctx.ownerId,
          projectId: ctx.projectId,
          conversationId,
          toolCallId: toolCall.id,
          input: args,
          agentRunId: ctx.agentRun?.id,
          toolInvocationId: ctx.agentRun?.invocationId,
          writer: ctx.databaseWriter,
        });
        return pendingImageRunResult(run);
      }
      case ToolName.SpawnAgent: {
        const args = SpawnAgentArgsSchema.parse(parseArgs(toolCall.arguments));
        const control = requireSubagentControl(tool, ctx);
        if (!("spawn" in control)) return control;
        return control.spawn(args);
      }
      case ToolName.WaitAgent: {
        const args = WaitAgentArgsSchema.parse(parseArgs(toolCall.arguments));
        const control = requireSubagentControl(tool, ctx);
        if (!("wait" in control)) return control;
        return control.wait(args, ctx.signal);
      }
      case ToolName.SendMessage: {
        const args = SendMessageArgsSchema.parse(parseArgs(toolCall.arguments));
        const control = requireSubagentControl(tool, ctx);
        if (!("sendMessage" in control)) return control;
        return control.sendMessage(args);
      }
      case ToolName.FollowupTask: {
        const args = FollowupTaskArgsSchema.parse(parseArgs(toolCall.arguments));
        const control = requireSubagentControl(tool, ctx);
        if (!("followupTask" in control)) return control;
        return control.followupTask(args);
      }
      case ToolName.InterruptAgent: {
        const args = InterruptAgentArgsSchema.parse(parseArgs(toolCall.arguments));
        const control = requireSubagentControl(tool, ctx);
        if (!("interrupt" in control)) return control;
        return control.interrupt(args);
      }
    }
  } catch (error) {
    if (ctx.signal?.aborted) {
      throw ctx.signal.reason ?? error;
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return errorResult(tool, ToolExecutionErrorCode.BadArgs, error instanceof Error ? error.message : String(error));
    }
    if (error instanceof FileOperationError) {
      return errorResult(tool, error.code, error.message);
    }
    if (error instanceof AttachmentError) {
      return errorResult(
        tool,
        error.code === AttachmentErrorCode.Unsupported ? ToolExecutionErrorCode.Unsupported : ToolExecutionErrorCode.InternalError,
        error.message,
      );
    }
    if (error instanceof FigmaInspectError) {
      return errorResult(tool, error.code, error.message);
    }
    return errorResult(tool, ToolExecutionErrorCode.InternalError, error instanceof Error ? error.message : String(error));
  }
}
