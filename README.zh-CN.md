<div align="center">

# Web Cursor — AI React 编码沙箱

自然语言需求 → 可运行 React 项目 → 浏览器预览 → 运行时反馈 → 自动修复。

[在线体验](https://web-cursor-seven.vercel.app/) · [案例展示](https://web-cursor-seven.vercel.app/showcase) · [工作原理](#工作原理)

[English](./README.md) · **简体中文**

</div>

![Web Cursor 首页](./docs/assets/web-cursor-home.png)

Web Cursor 是一个浏览器内的 AI React 编码沙箱。用户用自然语言描述界面，它会生成可运行的多文件 React 项目，在 WebContainer 中启动项目，并将真实预览结果反馈给 agent loop 修复错误。

## 核心差异

大多数代码生成器在输出源码后就停止了。Web Cursor 会闭合运行链路：编写项目、安装依赖、在浏览器中运行、检查错误与运行结果，然后修复项目并再次运行。

## 已实现能力

- 根据自然语言需求生成完整的 Rsbuild + React 项目
- 使用 Monaco Editor 和文件树编辑项目文件
- 在 WebContainer 中真实执行 `npm install` 和 `npm run dev`
- 将预览错误与运行结果反馈给 AI 修复闭环
- 使用 Postgres 持久化项目、文件、会话和消息
- 在同一项目的多个会话之间共享代码
- 上传图片进行视觉理解，并将生成图片保存为项目资产
- 通过 Figma OAuth 读取包含具体 `node-id` 的设计链接
- 通过案例展示发布只读项目示例
- 在中英文界面之间切换

## 工作原理

```text
自然语言需求
      ↓
Agent 编写 React 项目
      ↓
WebContainer 安装依赖并启动应用
      ↓
预览回传渲染状态与浏览器运行时错误
      ↓
Agent 修复项目并再次运行
```

Web Cursor 由三个执行域组成：

| 执行域 | 位置 | 职责 |
|---|---|---|
| A. LLM agent | Next.js Route Handlers | 持有 API key、调用 LLM、执行可信服务端工具并持久化 transcript |
| B. 浏览器编排 | Client Components | 执行仅客户端可用的预览工具、将预览结果返回服务端 loop，并管理工作台 |
| C. 沙箱 | iframe / WebContainer preview | 执行不可信的 AI 生成代码并回传运行结果 |

可选的第四个执行域预留给后端验证：

| 执行域 | 位置 | 职责 |
|---|---|---|
| D. 后端沙箱 | Vercel Sandbox / 外部 worker | 在隔离环境中执行安装、构建和浏览器验证，并把结构化结果返回 agent loop |

关键约束：

- LLM 凭证绝不进入浏览器或预览 iframe。
- AI 生成代码不可信，不在 Next.js 主服务进程中执行。
- 预览桥将 `RENDER_OK` 和 `RUNTIME_ERROR` 回传给浏览器编排层。
- 内部 Route Handler 只使用 `GET` 和 `POST`；写操作通过明确的请求体字段表达。

## 技术栈

| 领域 | 技术 |
|---|---|
| 应用 | Next.js App Router、React 19、TypeScript |
| 界面 | Tailwind CSS、Monaco Editor |
| 项目运行时 | WebContainer、Rsbuild |
| LLM 集成 | OpenAI SDK 兼容接口 |
| 持久化 | Postgres / Neon、drizzle-orm |
| 资产存储 | Vercel Blob |
| 客户端状态 | Zustand |
| 国际化 | next-intl |

## 本地开发

安装依赖：

```bash
pnpm install
```

启动 Next.js 开发服务器：

```bash
pnpm dev
```

如需在本地轮询异步生图任务，另开一个终端启动 runner：

```bash
pnpm dev:runner
```

推送数据库 schema：

```bash
pnpm db:push
```

执行生产构建：

```bash
pnpm build
```

## 环境变量

复制示例环境变量文件：

```bash
cp .env.example .env.local
```

基础的“对话 → 生成文件 → 预览”闭环需要：

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | Postgres 连接串，通常使用 Neon；`pnpm db:push` 也会读取它 |
| `DEEPSEEK_API_KEY` | agent loop 与代码补全使用的 LLM key；base URL 固定为 `server/llm.ts` 中的 `https://api.deepseek.com` |
| `BLOB_READ_WRITE_TOKEN` | `@vercel/blob` SDK 直接读取的 Vercel Blob 读写 token |

按需开启的能力：

| 变量 | 用途 | 何时需要 |
|---|---|---|
| `YUNWU_API_KEY` | `generate_image` 生图与图片附件理解 | 使用任一能力时 |
| `YUNWU_IMAGE_MODEL` | 覆盖默认生图模型 | 可选 |
| `FIGMA_CLIENT_ID` / `FIGMA_CLIENT_SECRET` | Figma OAuth | 开启 Figma 集成时 |
| `FIGMA_TOKEN_ENCRYPTION_KEY` | 加密保存的 Figma token | 已配置 Figma 集成时 |
| `FIGMA_REDIRECT_URI` | 覆盖回调地址；否则根据请求 origin 推导 | 可选 |
| `FIGMA_PROVIDER` | Figma provider；目前只支持 `rest` | 可选 |
| `CRON_SECRET` / `IMAGE_RUNNER_SECRET` | 保护 `/api/image-runner`；生产环境未配置任一变量时接口返回 `401` | 生产生图 runner |
| `IMAGE_RUNNER_URL` / `IMAGE_RUNNER_INTERVAL_MS` / `IMAGE_RUNNER_BATCH_SIZE` | 配置 `scripts/image-runner-dev.mjs` | 可选 |
| `NEXT_PUBLIC_SITE_URL` | canonical、sitemap、robots、社交 metadata 与 `llms.txt` 使用的站点绝对地址 | 可选 |

## 目录结构

```text
app/
  api/                         Next.js Route Handlers
  p/[projectId]/               项目工作台路由
  showcase/                    公开案例页

components/
  chat/                        对话与 AI 输出
  editor/                      Monaco 编辑器
  preview/                     预览面板
  project/                     首页与项目入口
  showcase/                    只读案例工作台
  workbench/                   工作台布局与状态边界

hooks/
  useWorkbenchController.ts    工作台主编排
  usePreview.ts                WebContainer 预览状态
  useProjectFiles.ts           项目文件读写
  useProjectSession.ts         项目恢复与会话切换

lib/
  webcontainer/                WebContainer 挂载、运行与协议
  *.ts                         客户端 API、类型与状态门面

server/
  db/                          Drizzle schema 与数据库连接
  image/                       异步生图任务与资产存储
  figma/                       Figma OAuth 与节点读取
  tools/                       Agent 工具定义与执行
```

## 当前限制

- 生成项目遵循仓库定义的 Rsbuild + React 项目契约，不支持任意前端框架。
- Figma 读取需要 OAuth 和包含具体 `node-id` 的链接，不是通用 Figma-to-React 转换器。
- 预览桥目前只回传渲染成功与浏览器运行时错误，尚未实现 console 捕获。
- 静态站点 ZIP 导出、后端沙箱验证和项目回滚尚未实现。

## 路线图

- 静态站点 ZIP 导出
- 可选的隔离后端验证
- 更完整的分享与发布链路
- 项目版本与回滚

## 设计文档

- [异步生图](./docs/async-image-generation.md) — 已实现的异步生图任务与项目资产设计
- [Figma 设计读取](./docs/figma-design-import.md) — 当前 OAuth 与节点级读取设计
- [静态 ZIP 导出](./docs/export-zip.md) — 规划中的导出设计
- [后端沙箱](./docs/backend-sandbox.md) — 规划中的隔离验证设计
- [多 Agent 架构](./docs/multi-agent-architecture.md) — 自治委派、上下文共享、通信协调、进度 UI 与隔离变更设计
- [需求基线](./REQUIREMENTS.md) — 历史产品基线；部分内容早于当前 WebContainer 与国际化实现
