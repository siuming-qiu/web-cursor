<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Web Cursor —— 项目规范

> 本块在 OPENSPEC 受管块之外,`openspec update` 不会覆盖它。

## 这是什么

浏览器内的 AI React 编码沙箱(类 Web 版 Cursor):自然语言 → AI 写 React 代码 → 沙箱即时执行渲染 → AI 读运行报错自主修复。
完整背景见 `@/openspec/project.md`,需求见 `@/REQUIREMENTS.md`,可交互原型 `prototype.html`。

## 三执行域(架构铁律)

| 域 | 位置 | 职责 |
|---|---|---|
| A. LLM 代理 | Next.js 服务端 Route Handler | 持 key、调 LLM、流式转发 |
| B. 编排 | 浏览器主线程 Client Component | 编辑器、agent loop、转译、收集结果 |
| C. 沙箱 | iframe(上线必须独立 origin) | 执行 AI 代码、捕获错误/console、回传 |

- **LLM key 绝不进 B/C 域**,只在 A 域服务端。前端只 `fetch('/api/...')`。
- AI 生成的是**不可信代码**,C 域必须隔离(`sandbox` 属性 + 独立 origin),禁止与 B 同 origin。
- 沙箱是**双向**的:iframe→父窗口至少回传 `RENDER_OK` / `RUNTIME_ERROR` / `CONSOLE`。这是喂回 agent loop 的 tool result,是自我修复闭环的接缝,不可省。

## AI-First 源文件头(借鉴 nebula-monorepo)

核心源文件(loop、转译、沙箱桥、Route Handler 等)顶部加结构化注释,让 agent 打开单文件即知其角色与 IO,无需扫全仓:

```ts
/**
 * [INPUT]: 这个文件吃什么(依赖、请求体、props)
 * [OUTPUT]: 吐什么(转发到哪、渲染/返回什么)
 * [POS]: 它在架构里是谁(一句话定位,如 "C 域沙箱↔B 域的错误回传桥")
 * [PROTOCOL]: 变更时先更新此头部,再检查本 CLAUDE.md
 */
```

工具/样板文件(配置、类型、纯展示组件)可不加。

## 开发哲学

- **手写 agent loop,不引入 LangChain**。自己写 while 循环(调 LLM → 执行工具 → 回填 → 再循环),目的是吃透 agentic 原理——这本身就是本项目的学习与简历价值所在。
- 好品味:消除特殊情况,函数 < 50 行、嵌套 < 3 层,简单可用胜过聪明复杂。
- 向后兼容:不破坏已跑通的闭环。

## 前端设计原则:状态拓扑优先

前端代码先设计**状态拓扑**,再设计组件树。

组件树描述 UI 结构;状态拓扑描述事实由谁拥有、变化从哪里发生、影响传到哪里。状态拓扑不清晰时,代码会自然退化为:外层组件囤积状态、子组件被动接收长 props、`useEffect` 在渲染后修补状态关系。

### useEffect 的定位

`useEffect` 不是业务流程编排工具,也不是 React state 之间的同步工具。

`useEffect` 只用于把 React 的结果同步到 React 之外的系统,例如 DOM、iframe、WebContainer、Monaco、window event、timer、网络订阅、资源清理等。

凡是不涉及外部系统的状态变化,优先用以下方式表达:

- **action**:事件发生时立即完成相关状态变更。
- **derived value**:从已有 state 在 render 阶段计算,不落进新 state。
- **state owner 调整**:把状态移动到真正拥有它的组件或 hook。
- **reducer / state machine**:把多个相关状态合并为明确的状态转移模型。

如果一个 effect 的核心逻辑是"观察 state A,然后 set state B",这通常不是 effect,而是状态拓扑错误的信号。先修 owner 和状态模型,不要用 effect 补偿。

### 组件粒度的判断标准

组件粒度不是按 JSX 行数决定,而是按状态边界决定。

一个组件应该拥有一组高内聚的事实:

- 同一个用户意图会同时改变它们。
- 它们共享生命周期。
- 它们由同一类外部事件驱动。
- 它们被同一个 UI 区域主要消费。

如果一个组件同时拥有多个互不相同生命周期的状态域,它就过粗。过粗组件会自然产生长 props、补偿型 effect 和"controller 大对象"。

### 顶层组件的职责

顶层组件只负责装配稳定边界:

- 选择页面模式。
- 连接少量跨域 coordinator。
- 布局主要区域。
- 传递领域模型,而不是展开所有字段。

顶层组件不应该拥有编辑器草稿、预览运行状态、聊天流状态、侧栏 loading 状态等细节事实。

### Hook 的边界

Hook 的价值是定义状态域,不是把代码从组件里搬出去。

好的 hook 表示一个清晰的状态 owner 或外部系统适配层,例如"项目文件状态"、"预览运行状态"、"聊天 agent 状态"。

坏的 hook 会把多个状态域聚合成一个大对象,再让页面组件继续分发它。这只是把上帝组件换成上帝 hook。

新增 state、hook 或 effect 前,先回答:

1. 这个事实的 owner 是谁?
2. 这个变化来自用户 action、派生计算,还是外部系统?
3. 这个状态是否和现有状态共享生命周期?
4. 如果不用 effect,能否通过 action、derived value、reducer 或移动 owner 表达?
5. 顶层组件是否只是装配,还是开始持有细节事实?

## API 方法约定

- 项目内 Route Handler 只写 `GET` / `POST`。
- 不新增 `PUT` / `PATCH` / `DELETE` 请求；写入、删除、重命名等变更动作统一走 `POST`，用明确的 body 字段表达动作。
- body 字段必须有明确 schema 校验；未知 action 或未知字段直接返回 400，不做兜底猜测。

## 枚举值约定

- 代码里不要散落裸字符串枚举值；错误码、事件类型、工具名、action、status 等有限集合必须先定义 `as const` 常量，再从常量推导类型。
- schema 里的 `z.literal(...)`、条件判断、返回值都引用同一份常量；不要在多处手写同一个枚举字符串。

## Git 铁律

- **未经显式授权,绝不 `git commit` / `git push`**。改完只汇报,等"提交/推送"指令。
- 每次 commit/push 单独授权;commit 用结构化信息(WHAT/WHY/HOW)。

## OpenSpec 工作流(何时用)

新增能力、破坏性变更、架构调整时,先按 `@/openspec/AGENTS.md` 走变更提案(proposal → 审批 → 实现 → archive),不要直接动手写代码。小改/修 bug 可跳过。
