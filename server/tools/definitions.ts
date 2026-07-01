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
    description: "创建或完整覆盖项目中的一个文件。content 必须是完整文件内容，不是 patch。写 package.json 时必须声明 Rsbuild React 项目所需 scripts、dependencies 和 devDependencies；不要写 Vite 或 esm.sh/webCursor 配置。",
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
      "在浏览器 WebContainer 中安装依赖并运行当前 Rsbuild 项目，返回 SERVER_READY、INSTALL_ERROR、DEV_SERVER_ERROR 或 BROWSER_RUNTIME_ERROR。只在一组自洽项目文件改动完成后做阶段性验收；不要在项目骨架未完整、本地 import 未闭合或明显半成品状态下调用。",
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
    name: ToolName.InspectFigmaDesign,
    description:
      "读取用户提供的 Figma frame/node 链接，返回经过服务端校验和压缩的设计事实。必须提供包含 node-id 的 figma.com/design 或 figma.com/file URL；不要猜测未返回的设计内容或图片 URL。",
    parameters: {
      type: "object",
      properties: {
        figmaUrl: {
          type: "string",
          description: "用户提供的 Figma design/file URL，必须包含 node-id，例如 https://www.figma.com/design/FILE/name?node-id=1-2",
        },
        maxDepth: {
          type: "number",
          description: "可选。返回 Figma 节点树的最大深度，默认 4，最大 8。",
        },
        includeAssets: {
          type: "boolean",
          description: "是否请求目标节点的临时 Figma 导出图片 URL。只有需要引用视觉资产时才设为 true。",
        },
      },
      required: ["figmaUrl", "includeAssets"],
      additionalProperties: false,
    },
  },
  {
    name: ToolName.GenerateImage,
    description:
      "异步生成一组网页视觉图片资产。用于独立站、营销页、产品页需要 hero 图、产品场景图、功能配图、背景视觉等真实图片资产时调用。prompt 是唯一生图语义来源；label 只用于前端展示。",
    parameters: {
      type: "object",
      properties: {
        images: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description: "给用户看的简短名称，例如 Hero visual。只用于 UI 展示，不影响生图语义。",
              },
              prompt: {
                type: "string",
                description: "完整图片生成提示词，必须描述内容、风格、用途和构图；不要依赖 label 表达语义。",
              },
              aspectRatio: {
                type: "string",
                enum: ["1:1", "4:3", "3:2", "16:9", "21:9", "9:16"],
                description: "期望构图比例。如果 provider 不支持显式比例，后端会作为 prompt 约束处理。",
              },
              inputImages: {
                type: "array",
                maxItems: 4,
                description:
                  "可选参考图片。只能引用当前会话已上传附件或项目内已有资产；不要传任意 URL 或 base64。",
                items: {
                  oneOf: [
                    {
                      type: "object",
                      properties: {
                        source: {
                          type: "string",
                          enum: ["attachment"],
                        },
                        attachmentId: {
                          type: "string",
                          description: "当前会话附件 id，必须来自用户消息列出的 attachmentId。",
                        },
                      },
                      required: ["source", "attachmentId"],
                      additionalProperties: false,
                    },
                    {
                      type: "object",
                      properties: {
                        source: {
                          type: "string",
                          enum: ["project_asset"],
                        },
                        assetId: {
                          type: "string",
                          description: "项目资产 id，必须来自已有工具结果或资产查询结果。",
                        },
                      },
                      required: ["source", "assetId"],
                      additionalProperties: false,
                    },
                  ],
                },
              },
            },
            required: ["prompt"],
            additionalProperties: false,
          },
        },
      },
      required: ["images"],
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
