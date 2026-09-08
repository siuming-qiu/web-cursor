import { z } from "zod";
import { AttachmentType, ImageMimeType } from "./attachment";
import {
  ClientToolErrorCode,
  DeleteFileResultSchema,
  GitCommitToolResultSchema,
  GitCurrentBranchToolResultSchema,
  GitLogToolResultSchema,
  GitStageResultSchema,
  GitStatusToolResultSchema,
  GitUnstageResultSchema,
  ListFilesResultSchema,
  ReadFileResultSchema,
  RenameFileResultSchema,
  SearchTextResultSchema,
  WriteFileResultSchema,
} from "./clientTool";
import {
  FigmaDesignContextSchema,
  FigmaErrorCode,
} from "./figma";
import {
  GenerateImageFailedRunResultSchema,
  GenerateImageSucceededRunResultSchema,
} from "./image";
import {
  ProjectRepositoryErrorCode,
  ProjectTextSearchMatchSchema,
} from "./projectRepository";
import {
  SubagentTaskStatus,
  SubagentTaskStatusSchema,
} from "./subagent";
import { LegacyPreviewResultSchema } from "./transcript";
import { ToolName, ToolResultType } from "./tool";
import { ToolResultSchema } from "./toolSchema";

/**
 * Shared source of truth for generic server tool errors. The executor imports
 * this contract so transcript validation never depends on a server-only module.
 */
export const ToolExecutionErrorCode = {
  BadArgs: ClientToolErrorCode.BadArgs,
  BadPath: ProjectRepositoryErrorCode.BadPath,
  BadRevision: "BAD_REVISION",
  BadSearchQuery: ProjectRepositoryErrorCode.BadSearchQuery,
  NotFound: ProjectRepositoryErrorCode.NotFound,
  Conflict: ProjectRepositoryErrorCode.Conflict,
  RevisionConflict: ProjectRepositoryErrorCode.RevisionConflict,
  StorageMismatch: "STORAGE_MISMATCH",
  Unsupported: "UNSUPPORTED",
  InternalError: ProjectRepositoryErrorCode.InternalError,
  FigmaNotConnected: FigmaErrorCode.NotConnected,
  FigmaInvalidUrl: FigmaErrorCode.InvalidUrl,
  FigmaNodeRequired: FigmaErrorCode.NodeRequired,
  FigmaUnauthorized: FigmaErrorCode.Unauthorized,
  FigmaForbidden: FigmaErrorCode.Forbidden,
  FigmaNotFound: FigmaErrorCode.NotFound,
  FigmaUnsupportedNode: FigmaErrorCode.UnsupportedNode,
  FigmaProviderUnavailable: FigmaErrorCode.ProviderUnavailable,
  FigmaRateLimited: FigmaErrorCode.RateLimited,
  FigmaAssetExportFailed: FigmaErrorCode.AssetExportFailed,
} as const;

export type ToolExecutionErrorCode =
  typeof ToolExecutionErrorCode[keyof typeof ToolExecutionErrorCode];

export const ToolExecutionErrorCodeSchema = z.enum(ToolExecutionErrorCode);

const CurrentRepositoryCommonErrorCode = {
  BadArgs: ToolExecutionErrorCode.BadArgs,
  NotFound: ToolExecutionErrorCode.NotFound,
  StorageMismatch: ToolExecutionErrorCode.StorageMismatch,
  LocalRepositoryMissing: ProjectRepositoryErrorCode.LocalRepositoryMissing,
  StaleSnapshot: ProjectRepositoryErrorCode.StaleSnapshot,
  ProtocolViolation: ProjectRepositoryErrorCode.ProtocolViolation,
  WorkerDisposed: ProjectRepositoryErrorCode.WorkerDisposed,
  InternalError: ToolExecutionErrorCode.InternalError,
} as const;

const CurrentFilePathErrorCode = {
  BadPath: ToolExecutionErrorCode.BadPath,
  ReservedPath: ProjectRepositoryErrorCode.ReservedPath,
} as const;

const CurrentListFilesErrorCode = {
  ...CurrentRepositoryCommonErrorCode,
} as const;

const CurrentSearchTextErrorCode = {
  ...CurrentRepositoryCommonErrorCode,
} as const;

const CurrentReadFileErrorCode = {
  ...CurrentRepositoryCommonErrorCode,
  ...CurrentFilePathErrorCode,
} as const;

const CurrentWriteFileErrorCode = {
  ...CurrentRepositoryCommonErrorCode,
  ...CurrentFilePathErrorCode,
  Conflict: ToolExecutionErrorCode.Conflict,
  RevisionConflict: ToolExecutionErrorCode.RevisionConflict,
} as const;

const CurrentDeleteFileErrorCode = {
  ...CurrentRepositoryCommonErrorCode,
  ...CurrentFilePathErrorCode,
  RevisionConflict: ToolExecutionErrorCode.RevisionConflict,
} as const;

const CurrentRenameFileErrorCode = {
  ...CurrentRepositoryCommonErrorCode,
  ...CurrentFilePathErrorCode,
  Conflict: ToolExecutionErrorCode.Conflict,
  RevisionConflict: ToolExecutionErrorCode.RevisionConflict,
} as const;

const CurrentGitCommonErrorCode = {
  BadArgs: ToolExecutionErrorCode.BadArgs,
  Unsupported: ToolExecutionErrorCode.Unsupported,
  RepositoryNotInitialized:
    ProjectRepositoryErrorCode.RepositoryNotInitialized,
  LocalRepositoryMissing: ProjectRepositoryErrorCode.LocalRepositoryMissing,
  StaleSnapshot: ProjectRepositoryErrorCode.StaleSnapshot,
  ProtocolViolation: ProjectRepositoryErrorCode.ProtocolViolation,
  WorkerDisposed: ProjectRepositoryErrorCode.WorkerDisposed,
  InternalError: ToolExecutionErrorCode.InternalError,
} as const;

const CurrentGitStageErrorCode = {
  ...CurrentGitCommonErrorCode,
  BadPath: ToolExecutionErrorCode.BadPath,
  ReservedPath: ProjectRepositoryErrorCode.ReservedPath,
  NotFound: ToolExecutionErrorCode.NotFound,
} as const;

const CurrentGitCommitErrorCode = {
  ...CurrentGitCommonErrorCode,
  NothingToCommit: ProjectRepositoryErrorCode.NothingToCommit,
} as const;

const CurrentRunPreviewErrorCode = {
  BadArgs: ToolExecutionErrorCode.BadArgs,
  Unsupported: ToolExecutionErrorCode.Unsupported,
  InternalError: ToolExecutionErrorCode.InternalError,
} as const;

const CurrentInspectAttachmentErrorCode = {
  BadArgs: ToolExecutionErrorCode.BadArgs,
  Unsupported: ToolExecutionErrorCode.Unsupported,
  InternalError: ToolExecutionErrorCode.InternalError,
} as const;

const CurrentInspectFigmaDesignErrorCode = {
  BadArgs: ToolExecutionErrorCode.BadArgs,
  FigmaNotConnected: ToolExecutionErrorCode.FigmaNotConnected,
  FigmaInvalidUrl: ToolExecutionErrorCode.FigmaInvalidUrl,
  FigmaNodeRequired: ToolExecutionErrorCode.FigmaNodeRequired,
  FigmaUnauthorized: ToolExecutionErrorCode.FigmaUnauthorized,
  FigmaForbidden: ToolExecutionErrorCode.FigmaForbidden,
  FigmaNotFound: ToolExecutionErrorCode.FigmaNotFound,
  FigmaProviderUnavailable:
    ToolExecutionErrorCode.FigmaProviderUnavailable,
  FigmaRateLimited: ToolExecutionErrorCode.FigmaRateLimited,
  FigmaAssetExportFailed: ToolExecutionErrorCode.FigmaAssetExportFailed,
  InternalError: ToolExecutionErrorCode.InternalError,
} as const;

const CurrentGenerateImageErrorCode = {
  BadArgs: ToolExecutionErrorCode.BadArgs,
  InternalError: ToolExecutionErrorCode.InternalError,
} as const;

const CurrentSubagentControlErrorCode = {
  BadArgs: ToolExecutionErrorCode.BadArgs,
  NotFound: ToolExecutionErrorCode.NotFound,
  Conflict: ToolExecutionErrorCode.Conflict,
  Unsupported: ToolExecutionErrorCode.Unsupported,
  InternalError: ToolExecutionErrorCode.InternalError,
} as const;

const LegacyReplyErrorCode = {
  BadArgs: ClientToolErrorCode.BadArgs,
  InternalError: ProjectRepositoryErrorCode.InternalError,
} as const;

const LegacyListFilesErrorCode = {
  BadArgs: ClientToolErrorCode.BadArgs,
  InternalError: ProjectRepositoryErrorCode.InternalError,
} as const;

const LegacyReadFileErrorCode = {
  BadArgs: ClientToolErrorCode.BadArgs,
  BadPath: ProjectRepositoryErrorCode.BadPath,
  NotFound: ProjectRepositoryErrorCode.NotFound,
  InternalError: ProjectRepositoryErrorCode.InternalError,
} as const;

const LegacyWriteFileErrorCode = {
  BadArgs: ClientToolErrorCode.BadArgs,
  BadPath: ProjectRepositoryErrorCode.BadPath,
  InternalError: ProjectRepositoryErrorCode.InternalError,
} as const;

const LegacyDeleteFileErrorCode = {
  ...LegacyReadFileErrorCode,
} as const;

const LegacyRenameFileErrorCode = {
  ...LegacyReadFileErrorCode,
  Conflict: ProjectRepositoryErrorCode.Conflict,
} as const;

export const ToolInterruptedResultSchema = z.object({
  status: z.literal("error"),
  type: z.literal(ToolResultType.ToolInterrupted),
  message: z.string(),
}).strict();

function genericErrorResultSchema(
  toolName: string,
  codeSchema: z.ZodType,
) {
  return z.object({
    status: z.literal("error"),
    tool: z.literal(toolName),
    code: codeSchema,
    message: z.string(),
  }).strict();
}

export const InspectAttachmentResultSchema = z.object({
  status: z.literal("ok"),
  tool: z.literal(ToolName.InspectAttachment),
  attachmentId: z.string().uuid(),
  attachmentType: z.literal(AttachmentType.Image),
  mimeType: z.enum(ImageMimeType),
  observations: z.string(),
}).strict();

export const GenerateImageTerminalResultSchema = z.union([
  z.object({
    status: z.literal("ok"),
    tool: z.literal(ToolName.GenerateImage),
    runId: z.string().uuid(),
    result: GenerateImageSucceededRunResultSchema,
  }).strict(),
  z.object({
    status: z.literal("error"),
    tool: z.literal(ToolName.GenerateImage),
    runId: z.string().uuid(),
    result: GenerateImageFailedRunResultSchema,
  }).strict(),
]);

export const SpawnAgentResultSchema = z.object({
  status: z.literal("ok"),
  tool: z.literal(ToolName.SpawnAgent),
  agentId: z.string().uuid(),
  taskStatus: z.literal(SubagentTaskStatus.Running),
}).strict();

const WaitAgentTerminalTaskStatusSchema = z.union([
  z.literal(SubagentTaskStatus.Completed),
  z.literal(SubagentTaskStatus.Failed),
  z.literal(SubagentTaskStatus.Interrupted),
]);

export const WaitAgentResultSchema = z.object({
  status: z.literal("ok"),
  tool: z.literal(ToolName.WaitAgent),
  agentId: z.string().uuid(),
  taskStatus: WaitAgentTerminalTaskStatusSchema,
  output: z.string().optional(),
  error: z.string().optional(),
}).strict().superRefine((result, context) => {
  const hasOutput = Object.prototype.hasOwnProperty.call(result, "output");
  const hasError = Object.prototype.hasOwnProperty.call(result, "error");

  if (result.taskStatus === SubagentTaskStatus.Completed) {
    if (!hasOutput) {
      context.addIssue({
        code: "custom",
        path: ["output"],
        message: "completed wait result must contain output",
      });
    }
    if (hasError) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "completed wait result must not contain error",
      });
    }
    return;
  }

  if (result.taskStatus === SubagentTaskStatus.Failed) {
    if (!hasError) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "failed wait result must contain error",
      });
    }
    if (hasOutput) {
      context.addIssue({
        code: "custom",
        path: ["output"],
        message: "failed wait result must not contain output",
      });
    }
    return;
  }

  if (hasOutput) {
    context.addIssue({
      code: "custom",
      path: ["output"],
      message: "interrupted wait result must not contain output",
    });
  }
  if (hasError) {
    context.addIssue({
      code: "custom",
      path: ["error"],
      message: "interrupted wait result must not contain error",
    });
  }
});

export const SendMessageResultSchema = z.object({
  status: z.literal("ok"),
  tool: z.literal(ToolName.SendMessage),
  agentId: z.string().uuid(),
  accepted: z.literal(true),
}).strict();

export const FollowupTaskResultSchema = z.object({
  status: z.literal("ok"),
  tool: z.literal(ToolName.FollowupTask),
  agentId: z.string().uuid(),
  accepted: z.literal(true),
}).strict();

export const InterruptAgentResultSchema = z.object({
  status: z.literal("ok"),
  tool: z.literal(ToolName.InterruptAgent),
  agentId: z.string().uuid(),
  previousTaskStatus: SubagentTaskStatusSchema,
  currentTaskStatus: SubagentTaskStatusSchema,
}).strict().superRefine((result, context) => {
  const expectedCurrent = result.previousTaskStatus === SubagentTaskStatus.Running
    ? SubagentTaskStatus.Interrupted
    : result.previousTaskStatus;
  if (result.currentTaskStatus !== expectedCurrent) {
    context.addIssue({
      code: "custom",
      path: ["currentTaskStatus"],
      message: "interrupt status transition does not match the runtime contract",
    });
  }
});

export type SpawnAgentResult = z.infer<typeof SpawnAgentResultSchema>;
export type WaitAgentResult = z.infer<typeof WaitAgentResultSchema>;
export type SendMessageResult = z.infer<typeof SendMessageResultSchema>;
export type FollowupTaskResult = z.infer<typeof FollowupTaskResultSchema>;
export type InterruptAgentResult = z.infer<typeof InterruptAgentResultSchema>;

const LegacyToolName = {
  Reply: "reply",
  WriteApp: "write_app",
} as const;

const LegacyProjectFileSummarySchema = z.object({
  path: z.string().min(1),
  updatedAt: z.string().datetime().optional(),
}).strict();

const LegacyListFilesResultSchema = z.object({
  status: z.literal("ok"),
  tool: z.literal(ToolName.ListFiles),
  files: z.array(LegacyProjectFileSummarySchema),
}).strict();

const LegacySearchTextResultSchema = z.object({
  status: z.literal("ok"),
  tool: z.literal(ToolName.SearchText),
  query: z.string(),
  matches: z.array(ProjectTextSearchMatchSchema),
  truncated: z.boolean(),
}).strict();

const LegacyReadFileResultSchema = LegacyProjectFileSummarySchema.extend({
  status: z.literal("ok"),
  tool: z.literal(ToolName.ReadFile),
  content: z.string(),
}).strict();

const LegacyWriteFileResultSchema = LegacyProjectFileSummarySchema.extend({
  status: z.literal("ok"),
  tool: z.literal(ToolName.WriteFile),
}).strict();

const LegacyDeleteFileResultSchema = z.object({
  status: z.literal("ok"),
  tool: z.literal(ToolName.DeleteFile),
  path: z.string().min(1),
}).strict();

const LegacyRenameFileResultSchema = z.object({
  status: z.literal("ok"),
  tool: z.literal(ToolName.RenameFile),
  oldPath: z.string().min(1),
  newPath: z.string().min(1),
  updatedAt: z.string().datetime().optional(),
}).strict();

const LegacyReplyResultSchema = z.object({
  status: z.literal("ok"),
  tool: z.literal(LegacyToolName.Reply),
  message: z.string(),
}).strict();

const CurrentResultSchemaByToolName: Readonly<
  Partial<Record<string, z.ZodType>>
> = {
  [ToolName.ListFiles]: ListFilesResultSchema,
  [ToolName.SearchText]: SearchTextResultSchema,
  [ToolName.ReadFile]: ReadFileResultSchema,
  [ToolName.WriteFile]: WriteFileResultSchema,
  [ToolName.DeleteFile]: DeleteFileResultSchema,
  [ToolName.RenameFile]: RenameFileResultSchema,
  [ToolName.GitStatus]: GitStatusToolResultSchema,
  [ToolName.GitStage]: GitStageResultSchema,
  [ToolName.GitUnstage]: GitUnstageResultSchema,
  [ToolName.GitCommit]: GitCommitToolResultSchema,
  [ToolName.GitLog]: GitLogToolResultSchema,
  [ToolName.GitCurrentBranch]: GitCurrentBranchToolResultSchema,
  [ToolName.RunPreview]: ToolResultSchema,
  [ToolName.InspectAttachment]: InspectAttachmentResultSchema,
  [ToolName.InspectFigmaDesign]: FigmaDesignContextSchema,
  [ToolName.GenerateImage]: GenerateImageTerminalResultSchema,
  [ToolName.SpawnAgent]: SpawnAgentResultSchema,
  [ToolName.WaitAgent]: WaitAgentResultSchema,
  [ToolName.SendMessage]: SendMessageResultSchema,
  [ToolName.FollowupTask]: FollowupTaskResultSchema,
  [ToolName.InterruptAgent]: InterruptAgentResultSchema,
};

const CurrentGenericErrorCodeSchemaByToolName: Readonly<
  Partial<Record<string, z.ZodType>>
> = {
  [ToolName.ListFiles]: z.enum(CurrentListFilesErrorCode),
  [ToolName.SearchText]: z.enum(CurrentSearchTextErrorCode),
  [ToolName.ReadFile]: z.enum(CurrentReadFileErrorCode),
  [ToolName.WriteFile]: z.enum(CurrentWriteFileErrorCode),
  [ToolName.DeleteFile]: z.enum(CurrentDeleteFileErrorCode),
  [ToolName.RenameFile]: z.enum(CurrentRenameFileErrorCode),
  [ToolName.GitStatus]: z.enum(CurrentGitCommonErrorCode),
  [ToolName.GitStage]: z.enum(CurrentGitStageErrorCode),
  [ToolName.GitUnstage]: z.enum(CurrentGitStageErrorCode),
  [ToolName.GitCommit]: z.enum(CurrentGitCommitErrorCode),
  [ToolName.GitLog]: z.enum(CurrentGitCommonErrorCode),
  [ToolName.GitCurrentBranch]: z.enum(CurrentGitCommonErrorCode),
  [ToolName.RunPreview]: z.enum(CurrentRunPreviewErrorCode),
  [ToolName.InspectAttachment]: z.enum(
    CurrentInspectAttachmentErrorCode,
  ),
  [ToolName.InspectFigmaDesign]: z.enum(
    CurrentInspectFigmaDesignErrorCode,
  ),
  [ToolName.GenerateImage]: z.enum(CurrentGenerateImageErrorCode),
  [ToolName.SpawnAgent]: z.enum(CurrentSubagentControlErrorCode),
  [ToolName.WaitAgent]: z.enum(CurrentSubagentControlErrorCode),
  [ToolName.SendMessage]: z.enum(CurrentSubagentControlErrorCode),
  [ToolName.FollowupTask]: z.enum(CurrentSubagentControlErrorCode),
  [ToolName.InterruptAgent]: z.enum(CurrentSubagentControlErrorCode),
};

const LegacySuccessSchemaByToolName: Readonly<
  Partial<Record<string, z.ZodType>>
> = {
  [ToolName.ListFiles]: LegacyListFilesResultSchema,
  [ToolName.SearchText]: LegacySearchTextResultSchema,
  [ToolName.ReadFile]: LegacyReadFileResultSchema,
  [ToolName.WriteFile]: LegacyWriteFileResultSchema,
  [ToolName.DeleteFile]: LegacyDeleteFileResultSchema,
  [ToolName.RenameFile]: LegacyRenameFileResultSchema,
};

const LegacyGenericErrorCodeSchemaByToolName: Readonly<
  Partial<Record<string, z.ZodType>>
> = {
  [ToolName.ListFiles]: z.enum(LegacyListFilesErrorCode),
  [ToolName.ReadFile]: z.enum(LegacyReadFileErrorCode),
  [ToolName.WriteFile]: z.enum(LegacyWriteFileErrorCode),
  [ToolName.DeleteFile]: z.enum(LegacyDeleteFileErrorCode),
  [ToolName.RenameFile]: z.enum(LegacyRenameFileErrorCode),
};

/**
 * Compatibility boundaries:
 * - c924091 file/reply writers emitted success results without revision.
 * - ff4613e through 454ea23 emitted search_text success without revision.
 * - 243437f's browser writer emitted exactly four preview shapes for write_app.
 * Unknown tool names have no success compatibility path.
 */
export function persistedToolResultSchemaFor(
  toolName: string,
): z.ZodType {
  if (toolName === LegacyToolName.Reply) {
    return z.union([
      LegacyReplyResultSchema,
      genericErrorResultSchema(
        toolName,
        z.enum(LegacyReplyErrorCode),
      ),
      ToolInterruptedResultSchema,
    ]);
  }

  if (toolName === LegacyToolName.WriteApp) {
    return z.union([
      LegacyPreviewResultSchema,
      genericErrorResultSchema(
        toolName,
        z.literal(ClientToolErrorCode.BadArgs),
      ),
      ToolInterruptedResultSchema,
    ]);
  }

  const current = CurrentResultSchemaByToolName[toolName];
  if (current) {
    const legacy = LegacySuccessSchemaByToolName[toolName];
    const legacyErrorCode =
      LegacyGenericErrorCodeSchemaByToolName[toolName];
    const currentErrorCode =
      CurrentGenericErrorCodeSchemaByToolName[toolName];
    if (!currentErrorCode) {
      throw new Error(
        `Missing current generic error contract for tool: ${toolName}`,
      );
    }
    const genericError = genericErrorResultSchema(
      toolName,
      currentErrorCode,
    );
    const legacyError = legacyErrorCode
      ? genericErrorResultSchema(toolName, legacyErrorCode)
      : null;
    if (legacy && legacyError) {
      return z.union([
        current,
        legacy,
        genericError,
        legacyError,
        ToolInterruptedResultSchema,
      ]);
    }
    if (legacy) {
      return z.union([
        current,
        legacy,
        genericError,
        ToolInterruptedResultSchema,
      ]);
    }
    return z.union([
      current,
      genericError,
      ToolInterruptedResultSchema,
    ]);
  }

  return z.union([
    genericErrorResultSchema(
      toolName,
      z.literal(ClientToolErrorCode.BadArgs),
    ),
    ToolInterruptedResultSchema,
  ]);
}

export function validatePersistedToolResult(
  toolName: string,
  value: unknown,
) {
  return persistedToolResultSchemaFor(toolName).safeParse(value);
}
