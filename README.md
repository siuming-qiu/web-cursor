# Web Cursor

Web Cursor 是一个浏览器内的 AI React 编码沙箱：用户用自然语言描述页面或应用，AI 生成 React 项目，在 WebContainer 中安装依赖、启动预览，并把运行错误反馈回 agent loop 让 AI 自主修复。

它的核心目标不是只生成一段代码，而是让 AI 对运行结果负责：写代码、跑起来、读报错、再修到可用。

## 当前状态

项目已经从早期原型升级为一个可持久化的多文件工作台。

已具备的主要能力：

- 自然语言生成 React 项目
- Rsbuild + React 多文件项目结构
- Monaco 文件编辑器与文件树
- WebContainer 内真实 `npm install` / `npm run dev` 预览
- 预览运行错误回传，用于 AI 自我修复
- Postgres 持久化项目、文件、会话和消息
- 首页最近项目列表
- 项目内多会话切换，同一项目共享代码
- 图片附件上传与视觉理解
- 异步 AI 生图任务，生成图片落到项目资产
- Figma OAuth 与设计检查能力
- Showcase 只读案例页
- 中英文界面切换

规划中：

- 静态站点 zip 导出，见 `docs/export-zip.md`
- 可选后端沙箱验证，见 `docs/backend-sandbox.md`
- 更完整的分享 / 发布链路
- 版本与回滚

## 技术栈

- Next.js App Router
- React 19
- TypeScript
- Tailwind CSS
- Monaco Editor
- WebContainer
- Rsbuild 生成项目运行时
- OpenAI SDK 兼容接口
- Postgres / Neon
- drizzle-orm
- Vercel Blob
- Zustand
- next-intl

## 架构边界

项目按三执行域组织：

| 域 | 位置 | 职责 |
|---|---|---|
| A. LLM 代理域 | Next.js Route Handler | 持有 key、调用 LLM、访问数据库和 Blob |
| B. 编排域 | 浏览器 Client Component | 编辑器、agent loop、WebContainer 编排、状态管理 |
| C. 沙箱域 | iframe / WebContainer preview | 执行 AI 生成代码、捕获运行结果 |

可选扩展：

| 域 | 位置 | 职责 |
|---|---|---|
| D. 后端沙箱域 | Vercel Sandbox / 外部 worker | 在独立隔离环境里执行 install/build/browser validation，并把结构化结果回传给 agent loop |

关键约束：

- LLM key 不进入浏览器和 iframe。
- AI 生成代码是不可信代码，不在 Next.js 主服务进程执行；如需后端运行，必须进入独立后端沙箱域。
- 沙箱必须能把 `RENDER_OK`、`RUNTIME_ERROR`、`CONSOLE` 等运行结果回传给编排层。
- 后端 API 只使用 `GET` / `POST`；写入动作通过明确 body 字段表达。

## 本地开发

安装依赖：

```bash
npm install
```

启动 Next.js：

```bash
npm run dev
```

如需本地轮询异步生图任务，另开一个终端：

```bash
npm run dev:runner
```

推送数据库 schema：

```bash
npm run db:push
```

生产构建：

```bash
npm run build
```

## 环境变量

项目依赖 `.env.local`，可从 `.env.example` 复制起步：

```bash
cp .env.example .env.local
```

跑通基础闭环（对话 → 写文件 → 预览）必须配置：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | Postgres 连接串（Neon）。`npm run db:push` 也读它 |
| `DEEPSEEK_API_KEY` | agent loop 与代码补全的 LLM key。baseURL 固定为 `https://api.deepseek.com`，硬编码在 `server/llm.ts`，没有对应环境变量 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 读写 token，由 `@vercel/blob` SDK 直接读取 |

按需开启的能力：

| 变量 | 用于 | 必填性 |
|---|---|---|
| `YUNWU_API_KEY` | 生图（`generate_image`）与图片附件识别 | 用到才需要 |
| `YUNWU_IMAGE_MODEL` | 覆盖默认生图模型 | 可选 |
| `FIGMA_CLIENT_ID` / `FIGMA_CLIENT_SECRET` | Figma OAuth | 用到才需要 |
| `FIGMA_TOKEN_ENCRYPTION_KEY` | 加密落库的 Figma token | 配了 Figma 就必填 |
| `FIGMA_REDIRECT_URI` | 覆盖回调地址，默认按请求 origin 推导 | 可选 |
| `FIGMA_PROVIDER` | 目前只支持 `rest` | 可选 |
| `CRON_SECRET` / `IMAGE_RUNNER_SECRET` | 保护 `/api/image-runner`。生产未配则该接口一律 401 | 生产必填 |
| `IMAGE_RUNNER_URL` / `IMAGE_RUNNER_INTERVAL_MS` / `IMAGE_RUNNER_BATCH_SIZE` | 本地 runner 脚本 `scripts/image-runner-dev.mjs` | 可选 |
| `NEXT_PUBLIC_SITE_URL` | 站点绝对地址（sitemap / robots） | 可选 |

## 目录导览

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
  useProjectSession.ts         项目会话恢复与切换

lib/
  webcontainer/                WebContainer 文件挂载、运行和契约
  *.ts                         客户端 API、类型和状态门面

server/
  db/                          drizzle schema 和连接
  image/                       异步生图任务与资产存储
  figma/                       Figma OAuth / inspect
  tools/                       agent 工具定义与执行
```

## 关键文档

- `REQUIREMENTS.md`：产品分期和需求背景
- `docs/backend-design.md`：持久化、项目/会话/消息模型
- `docs/backend-sandbox.md`：Vercel 部署下的后端沙箱方案、免费额度和 Cloudflare 取舍
- `docs/frontend-transpile.md`：前端转译与执行演进
- `docs/async-image-generation.md`：异步生图链路
- `docs/figma-design-import.md`：Figma 导入设计
- `docs/export-zip.md`：静态 zip 导出方案
- `openspec/AGENTS.md`：OpenSpec 变更流程

## 开发原则

- 手写 agent loop，不引入 LangChain。
- 状态拓扑优先，顶层组件只做装配。
- `useEffect` 只用于同步 React 外部系统，不用于普通 state 派生。
- 字段、enum、schema 必须来自明确契约，不靠代码猜业务语义。
- 小改动不强行补无意义测试；测试只服务真实回归风险。
- 未经明确授权不执行 `git commit` / `git push`。
