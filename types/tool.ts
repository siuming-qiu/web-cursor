import { z } from "zod";

export const ToolName = {
  ListFiles: "list_files",
  SearchText: "search_text",
  ReadFile: "read_file",
  WriteFile: "write_file",
  DeleteFile: "delete_file",
  RenameFile: "rename_file",
  GitStatus: "git_status",
  GitStage: "git_stage",
  GitUnstage: "git_unstage",
  GitCommit: "git_commit",
  GitLog: "git_log",
  GitCurrentBranch: "git_current_branch",
  RunPreview: "run_preview",
  InspectAttachment: "inspect_attachment",
  InspectFigmaDesign: "inspect_figma_design",
  GenerateImage: "generate_image",
  SpawnAgent: "spawn_agent",
  WaitAgent: "wait_agent",
  SendMessage: "send_message",
  FollowupTask: "followup_task",
  InterruptAgent: "interrupt_agent",
} as const;

export type ToolName = typeof ToolName[keyof typeof ToolName];

export const SearchTextLimits = {
  QueryCodePoints: 200,
  Matches: 50,
  SnippetCodePoints: 240,
} as const;

export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

export function containsUnicodeLineTerminator(value: string): boolean {
  return /[\r\n\u2028\u2029]/u.test(value);
}

export const ToolCommandPort = {
  DevServer: 5173,
} as const;

export const ToolCommand = {
  Install: "npm install",
  DevServer: `npm run dev -- --host 0.0.0.0 --port ${ToolCommandPort.DevServer}`,
} as const;

export type ToolCommand = typeof ToolCommand[keyof typeof ToolCommand];

export const ToolResultType = {
  ServerReady: "SERVER_READY",
  InstallError: "INSTALL_ERROR",
  DevServerError: "DEV_SERVER_ERROR",
  BrowserRuntimeError: "BROWSER_RUNTIME_ERROR",
  ToolInterrupted: "TOOL_INTERRUPTED",
} as const;

export type ToolResult =
  | { status: "ok"; type: typeof ToolResultType.ServerReady; port: number; url: string; rawLog?: string; durationMs?: number }
  | {
      status: "error";
      type: typeof ToolResultType.InstallError;
      command: typeof ToolCommand.Install;
      exitCode: number;
      message: string;
      rawLog: string;
    }
  | {
      status: "error";
      type: typeof ToolResultType.DevServerError;
      command: typeof ToolCommand.DevServer;
      exitCode: number | null;
      message: string;
      rawLog: string;
    }
  | { status: "error"; type: typeof ToolResultType.BrowserRuntimeError; message: string; stack?: string; rawLog?: string }
  | { status: "error"; type: typeof ToolResultType.ToolInterrupted; message: string };

export const ToolCallIdSchema = z.string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "tool call id must contain non-whitespace text",
  });

export const ToolCallNameSchema = z.string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "tool call name must contain non-whitespace text",
  });

export const ToolCallMetaSchema = z.object({
  id: ToolCallIdSchema,
  // Unknown model-emitted tool names must survive unchanged so the executor can
  // return an explicit unsupported-tool result instead of guessing a known name.
  name: ToolCallNameSchema,
  // Keep the exact provider bytes. JSON/tool-schema validation belongs to the
  // executor so a BAD_ARGS result and its malformed input remain replayable.
  arguments: z.string(),
}).strict();

export type ToolCallMeta = z.infer<typeof ToolCallMetaSchema>;
