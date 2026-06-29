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
          description: "项目内文件路径，例如 src/App.tsx 或 src/components/Button.tsx",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: ToolName.WriteFile,
    description: "创建或完整覆盖项目中的一个文件。content 必须是完整文件内容，不是 patch。写 package.json 时，用 webCursor.esmExternal 配置 esm.sh external 依赖；react 与 react-dom 应写入该数组以保证单 React 实例。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "项目内文件路径，例如 src/App.tsx 或 src/components/Button.tsx",
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
          description: "原项目内文件路径，例如 src/components/Button.tsx",
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
    name: ToolName.RunPreview,
    description:
      "在浏览器沙箱中编译并运行当前项目，返回 RENDER_OK、COMPILE_ERROR 或 RUNTIME_ERROR。只在一组自洽项目文件改动完成后做阶段性验收；不要在项目骨架未完整、本地 import 未闭合或明显半成品状态下调用。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: ToolName.InspectAttachment,
    description:
      "识别用户在当前会话中上传的附件内容。工具只返回附件中可见事实；后续如何使用由 agent 决定。只能读取后端在上下文中列出的 attachmentId。",
    parameters: {
      type: "object",
      properties: {
        attachmentId: {
          type: "string",
          description: "当前会话可检查的附件 id。必须来自用户消息中列出的 attachmentId。",
        },
      },
      required: ["attachmentId"],
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
