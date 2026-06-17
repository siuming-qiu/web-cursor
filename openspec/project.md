# Project Context

## Purpose

Web Cursor —— 浏览器内的 AI React 编码沙箱。用户用自然语言描述需求,AI 生成 React 代码,前端沙箱即时执行渲染,并能读取运行结果(报错/console)自主迭代修复。类 Web 版 Cursor。

定位:agent 开发学习项目 + 作品集。核心差异化不是"AI 生成代码",而是"AI 对运行结果负责——跑挂了自己修"的闭环。

## Tech Stack

- **框架**: Next.js(App Router)
- **语言**: TypeScript
- **编辑器**: Monaco(@monaco-editor/react)
- **转译**: Babel standalone(浏览器内 JSX/TS → JS)
- **执行沙箱**: iframe + Blob URL 注入,importmap + esm.sh 加载 React
- **LLM**: 经 Next.js Route Handler 服务端代理(key 不进前端)

## Project Conventions

### 三执行域(架构铁律)

| 域 | 位置 | 职责 |
|---|---|---|
| A. LLM 代理域 | Next.js 服务端(Route Handler) | 持 key、调 LLM、流式转发 |
| B. 编排域 | 浏览器主线程(Client Component) | 编辑器、agent loop、转译、收集结果 |
| C. 沙箱域 | iframe(上线必须独立 origin) | 执行 AI 代码、捕获错误/console、回传 |

- LLM key **绝不进 B/C 域**,只在 A 域服务端。
- AI 生成的是**不可信代码**,C 域必须隔离(`sandbox` 属性 + 独立 origin),禁止与 B 同 origin。

### 沙箱双向通信契约

沙箱不是单向渲染器,是双向的:执行代码 + 回传结果。iframe→父窗口至少要有 `RENDER_OK` / `RUNTIME_ERROR` / `CONSOLE` 三类消息——这是喂回 agent loop 的 tool result,是自我修复闭环的接缝。

### Code Style

- 单一职责,函数 < 50 行,嵌套 < 3 层。
- 复杂逻辑解释"为什么"而非"是什么"。
- 遵循 Prettier 默认 + 项目既有风格。

### Architecture Patterns

- **AI-First 文件头**(借鉴 nebula-monorepo,见 CLAUDE.md):核心源文件顶部加 `[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]` 注释块,让 agent 打开单文件即知其角色与 IO。
- **手写 agent loop**:不引入 LangChain,自己写 while 循环(调 LLM → 执行工具 → 回填 → 再循环),目的是吃透 agentic 原理。

### Testing Strategy

- 早期以"能跑通核心闭环"为验收(见 REQUIREMENTS.md 各期 Demo 验收)。
- 引入测试后:核心 loop / 转译 / 错误桥优先覆盖。

### Git Workflow

- 主分支 `main`。功能走 `feature/*`。
- commit 用结构化信息(WHAT/WHY/HOW)。
- **commit/push 需显式授权**,不自动执行。

## Domain Context

- 需求分三期,见根目录 `REQUIREMENTS.md`(R1–R18)。一期 = 核心闭环 MVP。
- 已有可交互高保真原型 `prototype.html`(纯前端模拟,非真实现)。
- 已有简单 playground 前身仓库 `my-playground`(Monaco + Babel + iframe),骨架可复用。

## Important Constraints

- 非目标(三期都不做):账号/多人协作、后端数据库持久化、任意 npm 包(WebContainers 仅远期备选)、多语言/多框架、移动端。
- 一期范围:单文件、固定依赖、非流式。

## External Dependencies

- LLM API(经服务端代理,provider 待定)
- esm.sh(沙箱内 React 等依赖的 CDN)
