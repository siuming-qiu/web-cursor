# 后端 TODO：文件架构拆分与 Agent 工具体系

> 目标：把 Web Cursor 从“单文件生成器”升级为“项目文件系统 + 可演进代码 Agent”。  
> 重点：这次不是临时支持多文件，而是建立后续读码再改、任务规划、预览自修复、版本回滚的基础设施。  
> 约束：不考虑历史兼容。旧数据、旧 transcript、旧 `write_app` 都可以删除或废弃。

## 0. 核心决策

从这次改造开始：

```text
project_files 是当前代码的唯一权威来源。
messages 只记录用户消息、assistant tool_call、tool result 和最终回复。
不再从 assistant message 恢复当前代码。
不再兼容旧 write_app 协议。
```

工具体系参考 nebula 的分层方式，但不用 YAML：

```text
server/tools/definitions.ts  # 工具定义：name / description / input schema
server/tools/executor.ts     # 工具执行器：tool_call -> 后端函数 -> tool result
server/files.ts              # 文件业务函数：查库、写库、路径校验
server/deepseek.ts           # LLM client + system prompt，引入 tool definitions
app/api/chat/route.ts        # agent loop：模型调用工具、执行工具、回填结果
```

LLM 看到的是工具 schema。  
真正查库和写库由 `executor.ts` 调 `server/files.ts` 完成。  
`projectId/ownerId/conversationId` 来自后端上下文，不让 LLM 传。

## 1. 目标工具集

第一版给 LLM 暴露这些工具：

```text
reply
list_files
read_file
write_file
delete_file
rename_file
```

暂不做：

```text
write_app
write_files
edit_files
apply_patch
search_files
delete_folder
rename_folder
run_command
npm_install
WebContainers
```

原因：

- `write_files` / `edit_files` 容易变成“一把梭”工具，不利于建立长期的“观察 -> 读取 -> 修改 -> 验证”Agent 流程。
- `apply_patch` 更适合第二阶段；第一版先用完整文件覆盖，降低 patch 应用失败风险。
- 文件夹是 UI 派生概念，第一版 Agent 只操作文件。

## 2. 数据清理

不考虑历史兼容，可以直接清理旧逻辑。

TODO：

- [ ] 删除 `write_app` 工具定义。
- [ ] 删除 `/api/chat` 中解析 `write_app.code` 的逻辑。
- [ ] 删除 `finalCode` / `code delta` 单文件流式逻辑。
- [ ] 删除从 assistant message 恢复 `lastCode` 的逻辑。
- [ ] 删除 `meta.kind === "code"` 作为当前代码来源的逻辑。
- [ ] 本地旧 DB 数据如果无价值，可以直接清空重建。

## 3. 数据模型

继续使用已有四张表：

```text
projects
project_files
conversations
messages
```

关系：

```text
projects 1 -> N project_files
projects 1 -> N conversations 1 -> N messages
```

规则：

- `project_files` 挂项目，不挂 conversation。
- 一个项目下多条 conversation 共享同一份代码。
- 切 conversation 只切聊天记录，不切代码。
- 文件夹不建表，由文件 path 派生。

TODO：

- [ ] 确认 `project_files` 有部分唯一索引：

```sql
unique(project_id, path) where deleted_at is null
```

- [ ] 所有文件读取都过滤 `deleted_at IS NULL`。
- [ ] 所有文件修改都更新 `projects.updated_at`。
- [ ] 不创建 `folders` 表。

## 4. 路径校验

后端统一校验文件路径，前端校验只负责体验。

文件 path 规则：

```text
1. 使用 / 分隔目录。
2. 不能以 / 开头。
3. 不能以 / 结尾。
4. 不能包含 //。
5. 不能包含 . 或 ...
6. 不能包含空 segment。
7. 必须包含文件名。
8. 同一个存活项目内 path 不能重复。
```

入口文件：

```text
App.tsx
```

规则：

- 后端不猜入口。
- 后端不自动创建入口。
- 缺少 `App.tsx` 由前端预览层报错。

TODO：

- [ ] 实现 `validateProjectFilePath(path: string)`。
- [ ] 非法 path 返回明确错误。
- [ ] 不自动修正 path。
- [ ] 不自动补扩展名。
- [ ] 不自动改名。

## 5. `server/files.ts`

新增：

```text
server/files.ts
```

职责：封装项目文件的真实业务操作。Route Handler 和 Tool Executor 都调用这里，不直接散落 SQL。

建议类型：

```ts
export type ProjectFileSummary = {
  path: string;
  updatedAt: string;
};

export type ProjectFileContent = {
  path: string;
  content: string;
  updatedAt: string;
};
```

TODO：

- [ ] `validateProjectFilePath(path: string): void`
- [ ] `listProjectFiles(projectId: string): Promise<ProjectFileSummary[]>`
- [ ] `readProjectFile(projectId: string, path: string): Promise<ProjectFileContent>`
- [ ] `writeProjectFile(projectId: string, path: string, content: string): Promise<ProjectFileContent>`
- [ ] `deleteProjectFile(projectId: string, path: string): Promise<void>`
- [ ] `renameProjectFile(projectId: string, oldPath: string, newPath: string): Promise<ProjectFileSummary>`

语义：

- `listProjectFiles`：返回 live files 列表，不返回 content。
- `readProjectFile`：读取单文件完整 content；不存在返回 `NOT_FOUND`。
- `writeProjectFile`：创建或完整覆盖单文件；第一版不做 patch。
- `deleteProjectFile`：软删单文件；不存在返回 `NOT_FOUND`。
- `renameProjectFile`：重命名/移动文件；`newPath` 冲突返回 `CONFLICT`。

## 6. `server/tools/definitions.ts`

新增：

```text
server/tools/definitions.ts
```

职责：集中定义 LLM 可见的工具 schema。类似 nebula 的 YAML tool definition，只是本项目先用 TS 写死。

TODO：

- [ ] 定义 `toolDefinitions`。
- [ ] 每个 definition 包含 `name`、`description`、`parameters`。
- [ ] 导出 OpenAI-compatible `tools` 数组。
- [ ] `server/deepseek.ts` 从这里 import `tools`。
- [ ] 不在 `server/deepseek.ts` 内联工具 schema。

目标工具 schema：

```ts
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
```

注意：

- `list_files` 不需要 `projectId` 参数。
- 所有文件工具都不接受 `projectId`、`ownerId`、`conversationId`。
- 当前项目由后端 `ToolExecutionContext` 绑定。

## 7. `types/tool.ts`

更新工具名：

```ts
export const ToolName = {
  Reply: "reply",
  ListFiles: "list_files",
  ReadFile: "read_file",
  WriteFile: "write_file",
  DeleteFile: "delete_file",
  RenameFile: "rename_file",
} as const;
```

TODO：

- [ ] 删除 `WriteApp`。
- [ ] 删除 `WriteFiles`。
- [ ] 增加上述新工具名。

## 8. `types/toolSchema.ts`

职责：校验 LLM 返回的 tool arguments。LLM 输出不可信，schema 外字段不能静默通过。

TODO：

- [ ] `ListFilesArgsSchema`
- [ ] `ReadFileArgsSchema`
- [ ] `WriteFileArgsSchema`
- [ ] `DeleteFileArgsSchema`
- [ ] `RenameFileArgsSchema`
- [ ] `ReplyArgsSchema`

建议：

```ts
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

export const ReplyArgsSchema = z.object({
  message: z.string().min(1),
}).strict();
```

说明：

- zod 只校验参数结构。
- 路径业务规则仍由 `server/files.ts` 校验。

## 9. `server/tools/executor.ts`

新增：

```text
server/tools/executor.ts
```

职责：统一执行 LLM tool call。类似 nebula 的 executor，但只处理当前项目文件工具。

上下文：

```ts
export type ToolExecutionContext = {
  ownerId: string;
  projectId: string;
  conversationId: string;
};
```

关键原则：

- LLM 不传 `projectId`。
- executor 从 `ToolExecutionContext.projectId` 获取当前项目。
- 所有工具执行结果都返回结构化 JSON。
- 工具失败也返回结构化错误，不抛到 agent loop 外层吞掉。

建议执行入口：

```ts
export async function executeToolCall(
  toolCall: ToolCallMeta,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  switch (toolCall.name) {
    case ToolName.ListFiles: {
      const args = ListFilesArgsSchema.parse(parseArgs(toolCall.arguments));
      const files = await listProjectFiles(ctx.projectId);
      return { status: "ok", tool: ToolName.ListFiles, files };
    }

    case ToolName.ReadFile: {
      const args = ReadFileArgsSchema.parse(parseArgs(toolCall.arguments));
      const file = await readProjectFile(ctx.projectId, args.path);
      return { status: "ok", tool: ToolName.ReadFile, ...file };
    }

    case ToolName.WriteFile: {
      const args = WriteFileArgsSchema.parse(parseArgs(toolCall.arguments));
      const file = await writeProjectFile(ctx.projectId, args.path, args.content);
      return { status: "ok", tool: ToolName.WriteFile, path: file.path, updatedAt: file.updatedAt };
    }

    case ToolName.DeleteFile: {
      const args = DeleteFileArgsSchema.parse(parseArgs(toolCall.arguments));
      await deleteProjectFile(ctx.projectId, args.path);
      return { status: "ok", tool: ToolName.DeleteFile, path: args.path };
    }

    case ToolName.RenameFile: {
      const args = RenameFileArgsSchema.parse(parseArgs(toolCall.arguments));
      const file = await renameProjectFile(ctx.projectId, args.oldPath, args.newPath);
      return { status: "ok", tool: ToolName.RenameFile, oldPath: args.oldPath, newPath: file.path };
    }

    case ToolName.Reply: {
      const args = ReplyArgsSchema.parse(parseArgs(toolCall.arguments));
      return { status: "ok", tool: ToolName.Reply, message: args.message };
    }
  }
}
```

TODO：

- [ ] 实现 `parseArgs`。
- [ ] 捕获 zod 错误并返回 `BAD_ARGS`。
- [ ] 捕获路径错误并返回 `BAD_PATH`。
- [ ] 捕获不存在并返回 `NOT_FOUND`。
- [ ] 捕获冲突并返回 `CONFLICT`。
- [ ] 其他错误返回 `INTERNAL_ERROR`。

## 10. Tool Result 类型

建议：

```ts
type ToolExecutionResult =
  | {
      status: "ok";
      tool: "list_files";
      files: { path: string; updatedAt?: string }[];
    }
  | {
      status: "ok";
      tool: "read_file";
      path: string;
      content: string;
      updatedAt?: string;
    }
  | {
      status: "ok";
      tool: "write_file";
      path: string;
      updatedAt?: string;
    }
  | {
      status: "ok";
      tool: "delete_file";
      path: string;
    }
  | {
      status: "ok";
      tool: "rename_file";
      oldPath: string;
      newPath: string;
    }
  | {
      status: "ok";
      tool: "reply";
      message: string;
    }
  | {
      status: "error";
      tool: string;
      message: string;
      code: "BAD_ARGS" | "BAD_PATH" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_ERROR";
    };
```

写入 `messages.content` 时使用 `JSON.stringify(result)`。

## 11. `server/deepseek.ts`

职责收敛：

- 保留 LLM client。
- 保留 `SYSTEM_PROMPT`。
- 从 `server/tools/definitions.ts` 引入 `tools`。
- 不内联工具 schema。

TODO：

- [ ] 删除旧 `tools` 数组。
- [ ] 删除 `write_app` prompt。
- [ ] `import { tools } from "@/server/tools/definitions"`。
- [ ] 更新 `SYSTEM_PROMPT`。

建议 prompt：

```text
你是 Web Cursor 的 React 项目编辑 Agent。

当前项目是一个虚拟文件系统。
入口文件固定为 App.tsx。
文件夹由文件路径派生，例如 components/Button.tsx。

工作方式：
- 不知道项目结构时，先调用 list_files。
- 修改已有文件前，先调用 read_file。
- 创建或完整覆盖文件时，调用 write_file。
- 删除文件时，调用 delete_file。
- 重命名或移动文件时，调用 rename_file。
- 需求不清或不需要改代码时，调用 reply。

规则：
- 不要假设未读取文件的内容。
- 不要用没在工具结果里出现过的文件内容做依据。
- 不要输出 markdown 代码块。
- write_file 必须提供完整文件内容。
- 不要通过“不返回某文件”表达删除，删除必须调用 delete_file。
- 不要通过“新建一个文件”表达重命名，重命名必须调用 rename_file。
- 不支持任意 npm 包。
- 只生成 React 相关代码。
```

## 12. `/api/chat` 改造

目标流程：

```text
user message 入库
-> 调 LLM
-> LLM 返回 tool_call
-> executeToolCall(toolCall, ctx)
-> tool result 入库
-> 带 tool result 继续调 LLM
-> 直到 reply 或达到 tool round 上限
-> 前端拿到文件变化后运行 preview
-> preview result 入库
-> 如失败，resume 继续修复
```

TODO：

- [ ] 从请求解析 `ownerId/projectId/conversationId`。
- [ ] 对 `resume` 通过 conversation 反查 projectId。
- [ ] 构造 `ToolExecutionContext`。
- [ ] 支持模型连续 tool calls。
- [ ] 每个 assistant tool_call 入 `messages`。
- [ ] 每个 tool result 入 `messages`。
- [ ] 工具失败也入 `messages`。
- [ ] 设置 `MAX_TOOL_ROUNDS = 8`，防止无限循环。
- [ ] 如果模型调用 `reply`，把 message 作为普通 chat 文本返回前端。
- [ ] 如果执行了 `write_file/delete_file/rename_file`，前端需要刷新文件列表和预览。

## 13. Messages 记录规则

必须保持 DeepSeek/OpenAI function calling 顺序：

```text
assistant(tool_calls=[...])
tool(tool_call_id=...)
assistant(...)
```

TODO：

- [ ] assistant message 保存 `meta.toolCalls`。
- [ ] tool message 保存 `meta.toolCallId`。
- [ ] 中断时用 `TOOL_INTERRUPTED` 闭合未完成 tool call。
- [ ] 不再用 `meta.kind = "code"` 表示当前代码。

## 14. REST API

这些接口给前端手动编辑用，不是 LLM 工具接口。

### `GET /api/projects/:id/files`

返回文件列表：

```ts
{
  files: [
    { path: "App.tsx", updatedAt: "..." }
  ]
}
```

### `GET /api/projects/:id/files/content?path=App.tsx`

返回单文件内容：

```ts
{
  path: "App.tsx",
  content: "...",
  updatedAt: "..."
}
```

### `POST /api/projects/:id/files/content`

保存单文件完整内容：

```ts
{
  "action": "write",
  "path": "App.tsx",
  "content": "..."
}
```

删除单文件：

```ts
{
  "action": "delete",
  "path": "App.tsx"
}
```

### `POST /api/projects/:id/files/rename`

重命名/移动文件：

```ts
{
  "oldPath": "components/Button.tsx",
  "newPath": "components/PrimaryButton.tsx"
}
```

TODO：

- [ ] 所有接口校验 `x-owner-id`。
- [ ] 所有接口校验 project 归属。
- [ ] 所有接口调用 `server/files.ts`，不要重复 SQL。
- [ ] Route Handler 只暴露 `GET` / `POST`，不要新增 `PUT` / `DELETE`。

## 15. 项目详情接口

更新：

```text
GET /api/projects/:id
```

返回：

```ts
{
  id,
  title,
  createdAt,
  updatedAt,
  conversations: [...],
  files: [
    { path: "App.tsx", updatedAt: "..." }
  ]
}
```

注意：

- 项目详情返回文件列表，不返回所有 content。
- 打开文件时再读 content。
- GET 时不自动补 `App.tsx`。

## 16. 前端手动编辑保存

规则：

- 手动编辑不经过 LLM。
- 不为每次键盘编辑追加 message。
- Agent 下一轮通过 `list_files/read_file` 看到用户最新改动。

TODO：

- [ ] 文件树读取 `GET /files`。
- [ ] 打开文件读取 `GET /files/content?path=...`。
- [ ] 保存文件调用 `POST /files/content`，body.action = `write`。
- [ ] 删除文件调用 `POST /files/content`，body.action = `delete`。
- [ ] 重命名文件调用 `POST /files/rename`。

## 17. Preview / 自修复

当前阶段：

- 预览仍在前端沙箱执行。
- 后端不执行 AI 代码。
- 后端不 bundle。
- 后端不跑 npm。

前端预览结果：

```text
RENDER_OK
COMPILE_ERROR
RUNTIME_ERROR
TOOL_INTERRUPTED
```

TODO：

- [ ] 多文件转译失败时带 `filePath`。
- [ ] import 找不到时返回明确 `COMPILE_ERROR`。
- [ ] runtime error 保留 stack。
- [ ] preview result 写入 messages，供下一轮修复读取。

## 18. 验收清单

文件 API：

- [ ] 能列出项目文件。
- [ ] 能读取单个文件。
- [ ] 能写入单个文件。
- [ ] 能删除单个文件。
- [ ] 能重命名单个文件。
- [ ] 非法 path 返回明确错误。
- [ ] 读取不存在文件返回明确错误。
- [ ] 重命名冲突返回明确错误。

Agent 工具：

- [ ] `server/tools/definitions.ts` 能导出完整 tools schema。
- [ ] LLM 能调用 `list_files`。
- [ ] LLM 能调用 `read_file`。
- [ ] LLM 能调用 `write_file`。
- [ ] LLM 能调用 `delete_file`。
- [ ] LLM 能调用 `rename_file`。
- [ ] 每个工具调用都走 `executeToolCall`。
- [ ] 每个工具结果都入 messages。
- [ ] 工具失败也会明确回给模型。
- [ ] 达到 tool round 上限后停止。

端到端：

- [ ] 用户要求生成页面，Agent 创建 `App.tsx`。
- [ ] 用户要求拆组件，Agent list/read 后新增组件文件并改 `App.tsx`。
- [ ] 用户要求删除组件，Agent 显式调用 `delete_file`。
- [ ] 用户要求重命名组件，Agent 显式调用 `rename_file`。
- [ ] 用户手动编辑文件后，下一轮 Agent 能 read 到最新内容。
- [ ] 预览报错后，Agent 能读取错误并修复对应文件。

## 19. 推荐开发顺序

1. 清理旧 `write_app` 代码路径。
2. 实现 `server/files.ts`。
3. 实现 `types/tool.ts` 新工具名。
4. 实现 `types/toolSchema.ts` 参数校验。
5. 实现 `server/tools/definitions.ts`。
6. 实现 `server/tools/executor.ts`。
7. 更新 `server/deepseek.ts` 引入 tools + 新 prompt。
8. 改造 `/api/chat` 支持 tool loop。
9. 实现文件 REST API。
10. 更新项目详情接口返回文件列表。
11. 前端接 REST API 做手动编辑。
12. 前端多文件转译和预览。
13. preview result 入 messages。
14. 跑端到端自修复。

## 20. 长期演进

这次先做文件工具，不做 patch。

后续再加：

```text
search_files
apply_patch
delete_folder
rename_folder
run_preview
create_checkpoint
rollback_checkpoint
```

长期目标：

```text
Agent 观察 -> 读取 -> 修改 -> 验证 -> 修复 -> 形成 checkpoint
```
