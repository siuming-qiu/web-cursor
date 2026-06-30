# Async Image Generation

> 目标：用户要求生成网站视觉图、hero 图、产品图、插画等资产时，agent 能创建异步生图任务，等待完成后把图片资产加入 React 页面。

## 0. 核心判断

【值得实现】

生图能力能补齐“独立站/营销页/产品页”中最影响观感的视觉资产。它和现有 agent loop 高度匹配：工具生成资产，agent 写 React 引用资产，再通过 Preview 验收。

【不建议实现】

不要把生图伪装成普通同步工具。完整产品必须支持异步 job、可恢复、可追踪、可闭合 tool result。否则长图生成会受 Route Handler 超时、用户刷新、网络中断影响。

## 1. 目标链路

```text
agent 调 generate_image
  -> 服务端创建 image_runs + image_jobs 记录
  -> SSE 返回 tool_pending(runId + jobs)
  -> 当前 /api/chat 结束或暂停
  -> 后台 worker 执行生图
  -> 生图完成后下载/解码图片
  -> 存 Vercel Blob
  -> 写 project_assets
  -> 写 role=tool 消息闭合 toolCallId
  -> 前端收到 job completed
  -> 调 /api/chat kind=resume
  -> agent 看到图片 tool result
  -> agent write_file 引用 asset.url
  -> agent run_preview 验收
```

agent 知道图片生成完成的唯一依据是 transcript 中出现合法 tool result，不靠猜、不靠自然语言提示。

## 2. 数据模型

新增 `image_runs`：

```text
image_runs
- id
- ownerId
- projectId
- conversationId
- toolCallId
- status: "pending" | "running" | "succeeded" | "failed"
- result
- error
- createdAt
- startedAt
- completedAt
- deletedAt
```

新增 `image_jobs`：

```text
image_jobs
- id
- runId
- status: "pending" | "running" | "succeeded" | "failed"
- input
- result
- error
- provider
- providerJobId
- createdAt
- startedAt
- completedAt
- deletedAt
```

新增或复用项目资产表：

```text
project_assets
- id
- ownerId
- projectId
- imageJobId
- source: "generated_image" | "figma_export" | "upload"
- mimeType
- blobPath
- publicUrl
- width
- height
- sizeBytes
- createdAt
- deletedAt
```

`project_assets` 是 Figma 导出、生图、上传图片的统一落点。

## 3. 工具契约

新增工具：

```text
generate_image
```

参数：

```ts
{
  images: Array<{
    label?: string;
    prompt: string;
    aspectRatio?: "1:1" | "4:3" | "3:2" | "16:9" | "21:9" | "9:16";
    inputImages?: Array<
      | { source: "attachment"; attachmentId: string }
      | { source: "project_asset"; assetId: string }
    >;
  }>;
}
```

规则：

- `images` 第一阶段最多 4 张；每个 item 对应一个独立 job，并归属于同一个 run。
- `prompt` 是唯一生图语义来源，必须由 agent 根据用户需求明确写出图片内容、风格、用途和构图。
- `label` 只用于前端展示和资产列表，不参与 provider 请求，不作为业务语义判断依据。
- `aspectRatio` 只表达尺寸/构图约束；如果 provider 不支持显式比例参数，则写入 prompt，不猜测 provider 私有字段。
- `inputImages` 是受控引用，只能指向当前会话附件或已有项目资产；不允许 agent 直接传任意 URL 或 base64。
- provider 层负责把 `inputImages` 解析成 YUNWU 需要的 `image`、`image_url` 或 Gemini `inline_data` 格式。
- 不提供 `purpose` 这类假控制 enum；AI 生图结果不可由本地枚举保证。
- 工具不直接返回图片；先返回 pending run。

pending 结果：

```json
{
  "status": "pending",
  "tool": "generate_image",
  "runId": "uuid",
  "jobs": [
    {
      "jobId": "uuid",
      "label": "Hero visual",
      "prompt": "Create a 16:9 hero image...",
      "aspectRatio": "16:9"
    }
  ],
  "message": "Image generation started."
}
```

完成后的 tool result：

```json
{
  "status": "ok",
  "tool": "generate_image",
  "runId": "uuid",
  "assets": [
    {
      "assetId": "uuid",
      "jobId": "uuid",
      "label": "Hero visual",
      "url": "https://blob.example/generated.jpeg",
      "mimeType": "image/jpeg",
      "width": 1376,
      "height": 768,
      "source": "generated_image"
    }
  ]
}
```

失败后的 tool result：

```json
{
  "status": "error",
  "tool": "generate_image",
  "runId": "uuid",
  "code": "IMAGE_PROVIDER_FAILED",
  "message": "Provider returned an error."
}
```

部分成功的 tool result：

```json
{
  "status": "partial_error",
  "tool": "generate_image",
  "runId": "uuid",
  "assets": [
    {
      "assetId": "uuid",
      "jobId": "uuid",
      "label": "Hero visual",
      "url": "https://blob.example/generated.jpeg",
      "mimeType": "image/jpeg",
      "width": 1376,
      "height": 768,
      "source": "generated_image"
    }
  ],
  "errors": [
    {
      "jobId": "uuid",
      "label": "Product scene",
      "code": "IMAGE_PROVIDER_FAILED",
      "message": "Provider returned an error."
    }
  ]
}
```

## 4. SSE / Chat 协议扩展

新增事件类型：

```ts
const ChatEventType = {
  ToolPending: "tool_pending",
  AssetCreated: "asset_created",
} as const;
```

`tool_pending`：

```ts
{
  type: "tool_pending";
  id: string;
  name: "generate_image";
  runId: string;
  jobs: Array<{
    jobId: string;
    label?: string;
    prompt: string;
    aspectRatio?: string;
  }>;
}
```

`asset_created`：

```ts
{
  type: "asset_created";
  runId: string;
  jobId: string;
  asset: ProjectAssetRef;
}
```

`/api/chat` 行为：

- 普通服务端工具执行完成后继续 loop。
- `generate_image` 创建 run 和 jobs 后返回 `tool_pending`，不继续请求 LLM。
- run 完成后由 worker 追加 `role=tool` 消息，闭合原 `toolCallId`。
- 前端调用 `kind=resume` 让 agent 继续。

## 5. Job 状态接口

新增接口：

```text
GET /api/image-runs/[id]
GET /api/image-runs?conversationId=...&status=active
GET /api/projects/[id]/assets
```

`GET /api/image-runs/[id]` 返回：

```ts
{
  id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  items: Array<{
    imageJobId: string;
    label?: string;
    prompt: string;
    aspectRatio?: string;
    status: "pending" | "running" | "succeeded" | "failed";
    asset?: ProjectAssetRef;
    error?: { code: string; message: string };
  }>;
}
```

`GET /api/image-runs?conversationId=...&status=active`：

- 返回当前会话未完成的 image runs。
- 用于页面刷新后恢复前端轮询和生成状态 UI。
- 必须校验 owner；不能返回其他 owner 的 run。

`GET /api/projects/[id]/assets`：

- 返回当前项目资产列表。
- 用于刷新后恢复图片引用和资产面板。

## 6. Worker 设计

后台执行职责：

```text
1. 领取 pending run 下的 pending jobs
2. 标记 run/job running
3. 逐个或并发调 provider 生图
4. 获取最终图片
5. 校验 MIME、大小和尺寸
6. 存 Vercel Blob
7. 写 project_assets
8. 更新 image_jobs.succeeded / failed
9. 聚合 run 状态：succeeded / failed
10. run 终态后 append role=tool message，meta.toolCallId = 原 toolCallId
```

失败职责：

```text
1. 更新 image_jobs.failed
2. append role=tool message，闭合 toolCallId
3. result 写明确错误码和 message
4. 前端 resume 后，agent 决定重试、降级或 reply
```

部署选择：

- Vercel Cron / Queue / 后台任务均可。
- 不依赖浏览器 tab 存活。
- job 状态必须在 DB 中可恢复。

## 7. Provider 抽象

不要把 OpenAI、其他生图平台的响应直接暴露给 agent。

```ts
interface ImageGenerationProvider {
  start(input: ImageGenerationInput): Promise<ImageProviderJob>;
  poll(providerJobId: string): Promise<ImageProviderStatus>;
  cancel?(providerJobId: string): Promise<void>;
}
```

输出统一为：

```ts
type GeneratedImage = {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width?: number;
  height?: number;
};
```

如果 provider 返回 URL：

```text
provider image URL
  -> 服务端下载
  -> 校验 content-type
  -> 存 Blob
```

如果 provider 返回 base64：

```text
base64
  -> Buffer
  -> 校验 MIME/尺寸
  -> 存 Blob
```

YUNWU `gemini-3.1-flash-image-preview` 实测契约：

```text
POST https://yunwu.ai/v1/chat/completions
  model: "gemini-3.1-flash-image-preview"
  messages[0].content: prompt

response.object = "chat.completion"
response.choices[0].message.content = "![image](data:image/jpeg;base64,...)"
```

解析规则：

- 只接受 `choices[0].message.content` 中明确出现的 Markdown data URL。
- 只接受 `image/png`、`image/jpeg`、`image/webp`。
- 找不到合法 data URL 时返回 `IMAGE_PROVIDER_FAILED`，并记录可诊断 message。
- 不把 response 文本当 URL，不猜测其他字段，不把未知结构映射成成功。

## 8. 错误码

```ts
const ImageJobErrorCode = {
  BadArgs: "IMAGE_BAD_ARGS",
  ProviderUnavailable: "IMAGE_PROVIDER_UNAVAILABLE",
  ProviderFailed: "IMAGE_PROVIDER_FAILED",
  TimedOut: "IMAGE_TIMED_OUT",
  Canceled: "IMAGE_CANCELED",
  UnsafeRequest: "IMAGE_UNSAFE_REQUEST",
  StorageFailed: "IMAGE_STORAGE_FAILED",
  AssetWriteFailed: "IMAGE_ASSET_WRITE_FAILED",
} as const;
```

要求：

- 不允许未知 provider 状态被映射成成功。
- 不允许 provider 失败时静默生成占位图。
- 不允许 agent 编造图片 URL。

## 9. Agent Prompt 规则

需要补充到 system prompt：

- 用户明确要求生成图片、hero 图、产品图、插画、背景图时，调用 `generate_image`。
- 独立站、营销页、产品页需要多张视觉资产时，一次 `generate_image` 可以提交多张 `images`。
- 每张图片的 `prompt` 必须完整描述图片内容、风格、用途和构图；不要依赖 `label` 表达语义。
- 只能在 tool result 返回 `assets[].url` 后引用图片。
- 如果图片 job 失败，不要伪造 URL；用 `reply` 暴露失败原因或调整 prompt 后重试。
- 图片生成成功后，将资产引用写入 React 项目文件，并调用 `run_preview` 验收。

## 10. 前端体验

前端把 `generate_image` 视为特殊 tool call。它不等待同步 tool result，而是接收 `tool_pending`，创建本地 Image Generation Run 视图，并通过轮询维护状态。

需要展示：

- 一次 run 中有多少张图。
- 每张图的 label / prompt 摘要 / aspectRatio。
- 每张图的 pending / running / succeeded / failed 状态。
- 已完成图片的缩略图。
- 部分成功状态：例如 `3 / 4 张已完成，1 张失败`。
- 当前 run 或 job 是否可取消。
- 刷新页面后仍能看到 pending job。
- 图片生成完成后自动 resume agent；失败和取消也要 resume，让 agent 读取闭合后的 tool result。
- 图片生成失败时显示明确错误。

聊天面板中的状态示例：

```text
Agent 正在生成页面视觉资产

[Image Generation]
生成 4 张图片
✓ Hero visual          已完成
◐ Product mockup       生成中
◌ Feature illustration 排队中
✕ Background texture   失败
```

完成后的图片卡片示例：

```text
Hero visual                  已完成
[缩略图]
Create a 16:9 hero image for...
尺寸：1376x768  类型：image/jpeg
```

前端状态结构：

```ts
type ImageGenerationRunView = {
  runId: string;
  toolCallId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  items: Array<{
    jobId: string;
    label?: string;
    prompt: string;
    aspectRatio?: string;
    status: "pending" | "running" | "succeeded" | "failed";
    asset?: ProjectAssetRef;
    error?: { code: string; message: string };
  }>;
};
```

轮询规则：

```text
收到 tool_pending(runId)
  -> 前端创建 ImageGenerationRunView
  -> 每 2 秒 GET /api/image-runs/[runId]
  -> pending/running 时继续轮询并更新图片卡片
  -> succeeded/failed 时停止轮询
  -> 如果该 runId 尚未 resume，调用 /api/chat kind=resume
```

防重复：

- 前端维护 `resumedRunIds`，同一个 run 只能触发一次 resume。
- 如果页面刷新后恢复到终态 run，但 transcript 已经继续，不重复 resume。
- 后端 `kind=resume` 前仍按现有逻辑检查并闭合中断 tool call，避免重复或乱序消息破坏上下文。

状态恢复：

```text
打开会话
  -> 读取 messages
  -> 查询 active image_runs
  -> 重建 ImageGenerationRunView
  -> 继续轮询 run
  -> run 终态后 resume
```

职责边界：

- 前端只展示生成过程、缩略图和错误，不直接修改项目代码。
- agent 只有在 worker 写入 `role=tool` 后，才能通过 resume 看到 `assets[].url`。
- 把图片加入页面代码必须由 agent 调 `write_file` 完成，而不是前端替 agent 插入代码。

## 11. 实施任务

```text
1. 设计并创建 image_runs / image_jobs / project_assets
2. 新增 ProjectAssetRef 类型
3. 新增 generate_image 工具定义和批量 images 参数 schema
4. executor 创建 pending run/jobs，不同步等待图片
5. /api/chat 支持 tool_pending SSE
6. 实现 image generation provider 抽象和 YUNWU Gemini image provider
7. 实现 worker：run/jobs pending -> running -> succeeded/failed
8. worker run 终态后 append role=tool message 闭合 toolCallId
9. 新增 image-runs 查询接口
10. 新增项目 assets 查询接口
11. 前端监听 tool_pending，渲染 Image Generation Run，并轮询 run 状态
12. 更新 system prompt
13. 端到端验证：generate_image 多图 run -> assets -> write_file -> run_preview
```

## 12. 验收标准

- agent 调用 `generate_image` 后，前端显示 Image Generation Run 和每张图的状态。
- 用户刷新页面后，pending run 和每张图的状态可恢复。
- 多张图可以分别展示 pending / running / succeeded / failed 状态。
- 已完成图片在聊天面板中显示缩略图。
- 图片完成后写入 `project_assets`，并生成稳定 Blob URL。
- tool result 被追加到 transcript，且 `toolCallId` 正确闭合。
- 前端自动 resume，agent 能使用图片 URL 写 React 页面。
- Preview 能渲染图片；失败时进入 agent 修复闭环。
- run/job 失败或部分失败都不会留下未闭合工具调用。
