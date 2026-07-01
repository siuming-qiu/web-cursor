export const ToolName = {
  Reply: "reply",
  ListFiles: "list_files",
  ReadFile: "read_file",
  WriteFile: "write_file",
  DeleteFile: "delete_file",
  RenameFile: "rename_file",
  RunPreview: "run_preview",
  InspectAttachment: "inspect_attachment",
  InspectFigmaDesign: "inspect_figma_design",
  GenerateImage: "generate_image",
} as const;

export type ToolName = typeof ToolName[keyof typeof ToolName];

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
      command: "npm install";
      exitCode: number;
      message: string;
      rawLog: string;
    }
  | {
      status: "error";
      type: typeof ToolResultType.DevServerError;
      command: "npm run dev -- --host 0.0.0.0 --port 5173";
      exitCode: number | null;
      message: string;
      rawLog: string;
    }
  | { status: "error"; type: typeof ToolResultType.BrowserRuntimeError; message: string; stack?: string; rawLog?: string }
  | { status: "error"; type: typeof ToolResultType.ToolInterrupted; message: string };

export type ToolCallMeta = {
  id: string;
  name: ToolName | string;
  arguments?: string;
};
