/**
 * [INPUT]: 无
 * [OUTPUT]: OpenAI-compatible tools schema for DeepSeek function calling
 * [POS]: A 域工具定义层 —— 只描述 LLM 可见工具，不执行工具
 * [PROTOCOL]: 新增/修改工具先改这里，再同步 types/toolSchema.ts 和 executor.ts
 */
import "server-only";
import { ToolName } from "@/types/tool";

export const toolDefinitions = [
  {
    name: ToolName.ListFiles,
    description: "列出当前项目的文件路径。用于在修改前了解项目结构。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: ToolName.ReadFile,
    description: "读取当前项目中某个文件的完整内容。修改已有文件前必须先读取。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "项目内文件路径，例如 App.tsx 或 components/Button.tsx",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: ToolName.WriteFile,
    description: "创建或完整覆盖项目中的一个文件。content 必须是完整文件内容，不是 patch。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "项目内文件路径，例如 App.tsx 或 components/Button.tsx",
        },
        content: {
          type: "string",
          description: "完整文件内容。不要包含 markdown 代码块围栏。",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: ToolName.DeleteFile,
    description: "删除当前项目中的一个文件。删除必须显式调用本工具。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "要删除的项目内文件路径，例如 components/OldButton.tsx",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: ToolName.RenameFile,
    description: "重命名或移动当前项目中的一个文件。移动文件也使用本工具。",
    parameters: {
      type: "object",
      properties: {
        oldPath: {
          type: "string",
          description: "原项目内文件路径，例如 components/Button.tsx",
        },
        newPath: {
          type: "string",
          description: "新项目内文件路径，例如 components/PrimaryButton.tsx",
        },
      },
      required: ["oldPath", "newPath"],
      additionalProperties: false,
    },
  },
  {
    name: ToolName.Reply,
    description: "需求不清或不需要修改代码时，用自然语言回复用户。",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "回复用户的内容。",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
] as const;

export const tools = toolDefinitions.map((tool) => ({
  type: "function" as const,
  function: tool,
}));
