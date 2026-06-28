# 前端转译层设计（esbuild-wasm）

> 面向「学前端工程」。讲清：转译层在架构里是谁、为什么用 esbuild-wasm 替掉 Babel、怎么集成（Worker）、怎么和 iframe 沙箱对接。含 pseudocode。
> 范围：纯前端 B 域，**不涉及后端**（后端见 `backend-design.md`）。

---

## 0. 转译层在架构里是谁

回顾三执行域。转译发生在 **B 域（浏览器主线程 / Worker）**，夹在"AI 出代码"和"沙箱跑代码"之间：

```
AI 生成完整 Vite React 项目文件
      │
      ▼  ① 转译层：esbuild-wasm   index.html + src/main.tsx + 本地依赖 ──→ 浏览器能跑的 JS/CSS
      │     （解析本地 import 并打包，不执行）
      ▼
注入 C 域 iframe 沙箱执行（importmap + esm.sh 解析 import）
      │
      ▼  RENDER_OK / RUNTIME_ERROR 回传 → 喂 agent loop
```

**关键认知**：转译 ≠ 执行。转译只是 `字符串 → 字符串`（把 `<div/>`、`: number` 这种浏览器不认的语法转成它认的 JS），是**纯文本变换、绝对安全**。真正危险的"执行 AI 代码"在 C 域 iframe，和转译层无关。所以换转译器**不动安全边界**。

---

## 1. 为什么从 Babel 换成 esbuild-wasm

| | Babel standalone（旧） | esbuild-wasm（新） |
|---|---|---|
| 实现 | 纯 JS | Go 编译到 WASM |
| 速度 | 最慢（playground 里转译是肉眼可感的卡） | 极快（同样的文件快一个数量级以上） |
| 包体 | ~3MB JS，随 bundle 一起 | ~10MB 的 `.wasm`，**按需异步加载**（gzip 后小很多） |
| 启动 | `import` 即用（同步） | 要先 `await initialize()` 拉 wasm、初始化一次 |
| 线程 | 主线程，转译时阻塞 UI | 可跑 Web Worker，不卡 UI |

**换的动机**：本项目每次 AI 迭代（自我修复每一轮）都要转译一遍，Babel 的慢会直接拖慢"生成→看到结果"的体感。esbuild-wasm 用一次性的"加载 + 初始化"成本，换来之后每次转译都飞快。

**代价**（要认）：首次要下载 ~MB 级 `.wasm` 并异步 init，有"冷启动"延迟；Babel 是即拿即用但每次都慢。本项目选择把成本前置到启动一次。

---

## 2. 核心 API：多文件项目使用 `build/bundle`

esbuild 有两个能力：`transform`（转单文件语法）和 `build/bundle`（解析依赖、打包）。当前项目文件已经是完整 Vite React 项目，预览入口由 `index.html` 中的 module script 声明，所以项目预览使用 `build`：

- 本地相对 import 从 project_files 中解析并打包。
- 第三方依赖根据 `package.json` 映射到 esm.sh external URL。
- 缺少 `index.html` 或 module script 时由预览层报明确编译错误，不自动补文件。
- `src/main.tsx` 通常负责挂载 `src/App.tsx` 到 `#root`。

```ts
// build 的输入输出
输入: ["index.html", "src/main.tsx", "src/App.tsx", "package.json"]
输出: { entryPath: "src/main.tsx", js: "...", css: "..." }
```

---

## 3. 集成：放进 Web Worker

转译丢进 Worker，避免大文件转译时卡主线程的编辑器/动画。

```
lib/transpile/
  worker.ts        # Web Worker：初始化 esbuild + 收消息转译
  client.ts        # 主线程侧：起 worker、发请求、收结果（Promise 封装）
public/
  esbuild.wasm     # 自托管 wasm（也可用 CDN，但自托管更稳/可离线）
```

### 3.1 Worker 端

```ts
// lib/transpile/worker.ts  —— 跑在 Web Worker 里
import * as esbuild from 'esbuild-wasm'

let ready = null   // 初始化只做一次，缓存这个 Promise

function ensureInit() {
  // 多次调用复用同一个 init Promise，避免重复初始化（esbuild 重复 init 会报错）
  if (!ready) {
    ready = esbuild.initialize({
      wasmURL: '/esbuild.wasm',   // 自托管路径
      worker: false,              // 我们已经在 worker 里了，别再套一层
    })
  }
  return ready
}

self.onmessage = async (e) => {
  const { id, code } = e.data
  try {
    await ensureInit()
    const result = await esbuild.transform(code, {
      loader: 'tsx',              // 同时吃 JSX + TS
      jsx: 'automatic',           // 用 React 17+ 自动 runtime，源码不用手动 import React
      target: 'es2020',
      // sourcemap: 'inline',     // 可选：要把运行时报错行号映射回源码就开
    })
    // 转译成功：回传 JS 代码 + esbuild 的 warnings
    self.postMessage({ id, ok: true, code: result.code, warnings: result.warnings })
  } catch (err) {
    // 转译失败 = 语法错误。这是「编译报错」，要喂给 agent loop（R3）
    self.postMessage({ id, ok: false, errors: err.errors ?? [{ text: String(err) }] })
  }
}
```

### 3.2 主线程端（Promise 封装）

```ts
// lib/transpile/client.ts —— 主线程调用入口
let worker = null
let seq = 0
const pending = new Map()   // id → {resolve, reject}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const { id, ok, code, errors } = e.data
      const p = pending.get(id); pending.delete(id)
      ok ? p.resolve(code) : p.reject(new TranspileError(errors))
    }
  }
  return worker
}

// 对外就这一个函数：源码 → 转译后的 JS（失败抛 TranspileError）
export function transpile(code) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, code })
  })
}
```

> 学习点：`id` + `pending` Map 是因为 Worker 通信是"发了不知道哪条先回"的异步。用自增 id 把"请求"和"响应"配对，是 worker RPC 的标准写法。

---

## 4. 和 iframe 沙箱怎么对接

转译产物（纯 JS）注入 C 域 iframe 执行。转译层只负责到"产出 JS"为止，注入是沙箱模块的事，但要约定好接缝：

```ts
// agent loop 里这一段（B 域）
let js
try {
  js = await transpile(aiCode)          // ① 转译
} catch (e) {
  // 编译报错：根本没跑就挂了，直接作为 RUNTIME 之外的「编译错误」喂回 AI
  return { type: 'COMPILE_ERROR', error: formatErrors(e.errors) }
}
sandbox.run(js)                          // ② 注入 iframe（importmap 解析 import）
const result = await sandbox.waitResult() // ③ 等回传 RENDER_OK / RUNTIME_ERROR
```

要点：
- iframe 里要有 **importmap** 把 `react` / `react-dom` 指向 esm.sh，转译保留的 `import` 才解析得了。
- esbuild 的 `jsx: 'automatic'` 会生成 `import { jsx } from "react/jsx-runtime"`，importmap 里这个也要映射到 esm.sh 对应入口。
- 转译失败（语法错）和运行失败（RUNTIME_ERROR）是**两种不同的报错**，都要能喂回 agent loop（对应 R3「执行结果可观测」要区分编译报错 / 运行报错）。

---

## 5. 错误分类（喂 agent loop 的关键）

转译层让"报错可观测"更完整。agent loop 现在能拿到三种失败，分别处理：

| 来源 | 类型 | 怎么产生 | 喂回 AI 的话术 |
|---|---|---|---|
| 转译层 | `COMPILE_ERROR` | esbuild `transform` 抛错（语法非法） | "代码编译失败：{esbuild 错误，含行列}，请修语法" |
| 沙箱 | `RUNTIME_ERROR` | iframe 里执行抛异常 | "运行时报错：{stack}，请修复" |
| 沙箱 | `RENDER_OK` | 正常渲染 | —（结束循环） |

esbuild 的错误对象带 `location`（文件、行、列、出错那行文本），比 Babel 的报错更结构化，喂给 AI 定位更准——这是换 esbuild 的一个额外收益。

---

## 6. 从 Babel 迁移要改什么（如果先用 Babel 跑通过）

如果按建议"先 Babel 跑通闭环、再换"，迁移点很集中：

1. **加载方式**：Babel 是 `<script>` / `import` 同步即用；esbuild 要在 app 启动时 `await initialize()` 一次。所以要处理"wasm 还没 ready 时用户就点生成"——加载态 / 等 init 完成再放行。
2. **调用 API**：`Babel.transform(code, { presets:['react','typescript'] }).code` → `esbuild.transform(code, { loader:'tsx', jsx:'automatic' }).code`。
3. **错误形态**：Babel 抛带 message 的 Error；esbuild 抛带 `errors[]`（含 location）。`formatErrors` 要重写。
4. **JSX runtime**：确认 importmap 里有 `react/jsx-runtime`（automatic runtime 需要）。
5. **删依赖**：移除 `@babel/standalone`，加 `esbuild-wasm`，把 `esbuild.wasm` 放进 `public/`。

> 这一步换完，可以记一组对比数据（同一段代码 Babel vs esbuild 的转译耗时 + 包体），就是很实在的学习/简历产出。

---

## 7. 开放问题（实现前定）

- **wasm 自托管 vs CDN**：自托管（放 `public/esbuild.wasm`）更稳、可离线、版本可控；CDN 省事但多一个外部依赖。倾向自托管。
- **版本对齐**：`esbuild-wasm` 的 npm 包版本必须和 `esbuild.wasm` 文件版本**严格一致**，否则 init 报错。锁版本。
- **要不要 sourcemap**：开 `sourcemap:'inline'` 能让 RUNTIME_ERROR 的行号映射回源码，AI 修得更准，但产物变大。一期可先不开，R4「错误可见」做精时再开。
