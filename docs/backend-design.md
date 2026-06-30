# Web Cursor 后端详细设计

> 面向「学 agent 开发 + 后端开发」。每个接口给：用途 / 请求 / 响应 / 实现步骤 / 伪代码。
> 技术栈：Next.js App Router（Route Handler）+ Postgres（Neon）+ drizzle-orm + zod。
> 伪代码是 TS 风格，便于理解；不是最终实现，落地时按真实 API 调整。

> ⚠️ **本文以 `docs/backend-todo.md` 为权威（2026-06 · B-shared / Cursor 模型）**：`projects 1—N conversations 1—N messages`，`project_files` 挂项目、**会话间共享**（切会话不改代码）。`/api/chat` 收 `projectId`（必传）+ `conversationId`（可选，没传则懒建会话、经 SSE `init` 回传 conversationId），**无独立"建会话"接口（⑩ 不实现）**。四表均加 `deleted_at` 软删；不抽响应信封（裸返数据）。下方凡与此冲突，一律以 `backend-todo.md` 为准。

---

## 0. 先搞清楚：后端在整个 agent 里是什么角色

这是学 agent 开发**最关键的认知**。本项目的 agent loop（"调 AI → 跑代码 → 读报错 → 再让 AI 改"的循环）**不在后端，在浏览器**。后端只提供两类"工具接口"给这个 loop 用：

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器（B 域）—— agent loop 在这里手写 while 循环             │
│                                                               │
│   let turn = { role:'user', content: 用户需求 }              │
│   while (没跑通 && 没到上限) {                                  │
│     code   = 调 POST /api/chat { convId, ...turn }            │
│              ↑ 后端：读历史→拼上下文→调AI→把user+assistant落库 │
│              ↑ 流式吐回代码（前端不持有/不拼上下文）           │
│     存代码  = 调 POST /api/projects/:id/files                 │
│     result = 丢进 iframe 沙箱执行（C 域，浏览器内，不走后端）    │
│     if (RENDER_OK) break                                       │
│     else turn = { role:'tool', content: 报错 }  // 作为下一轮  │
│   }                                                           │
└─────────────────────────────────────────────────────────────┘
```

所以后端接口分两组职责：
1. **`/api/chat`（有状态）**—— 持 key 调 DeepSeek + **拥有对话记忆**（读写 transcript、拼上下文）。key 和 system prompt 都不进浏览器。这是 agent 的"记忆和嘴"。
2. **持久化 CRUD**（projects / files / conversations / messages）—— 让代码和对话不随刷新丢失。

后端**永远不执行 AI 生成的代码**（那是 iframe 沙箱的事），对后端来说 AI 代码只是一段字符串。

---

## 1. 技术栈与公共约定

| 项 | 选择 | 为什么 |
|---|---|---|
| 路由 | Next.js Route Handler（`app/api/**/route.ts`） | 和前端同仓，单体部署 |
| DB 驱动 | `@neondatabase/serverless` `Pool` + drizzle `neon-serverless` | 需要支持 `db.transaction(...)`；用 Neon WebSocket serverless driver，避免普通 `pg` 在 serverless 多实例下直接打爆连接数 |
| ORM | `drizzle-orm` + `drizzle-kit` | TS-first、贴近 SQL、迁移是可读的 .sql |
| 校验 | `zod` | 每个接口入口校验请求体，杜绝裸用用户输入 |

### 1.1 统一响应格式

> ⚠️ **已弃用（见 `docs/backend-todo.md` S6 决策）**：`ok`/`fail`/`HttpError` 零逻辑、当前零收益，不抽。接口直接 `Response.json(data, {status})`、错误 `Response.json({ error }, {status})` + 内联 try/catch。下面这套信封留作将来参考——等"接口多到重复烦人 / 前端需要统一形状"时再引。

（原方案，留作参考）所有 **JSON 接口**（除 `/api/chat` 流式外）统一信封，前端好处理：

```ts
// 成功
{ "ok": true,  "data": <任意> }
// 失败
{ "ok": false, "error": { "message": "人话", "detail": <可选，调试用> } }
```

```ts
// lib/http.ts —— 两个小helper，全后端复用
function ok(data, status = 200) {
  return Response.json({ ok: true, data }, { status })
}
function fail(status, message, detail) {
  return Response.json({ ok: false, error: { message, detail } }, { status })
}
```

### 1.2 owner 身份（不是鉴权，是数据隔离）

没有账号系统。前端首次访问生成一个匿名 id 存 localStorage，之后每个请求带 `x-owner-id` 头。后端用它给数据分命名空间。

```ts
// 前端 lib/owner.ts
function getOwnerId(): string {
  let id = localStorage.getItem('owner-id')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('owner-id', id) }
  return id
}
// 之后所有 fetch 都带： headers: { 'x-owner-id': getOwnerId() }
```

```ts
// 后端 lib/owner.ts —— 从请求里取 owner，缺了就拒绝（避免产生无主数据）
function requireOwner(req): string {
  const id = req.headers.get('x-owner-id')
  if (!id || !isUuid(id)) throw new HttpError(400, 'missing or invalid x-owner-id')
  return id
}
```

> ⚠️ 这不是鉴权：`x-owner-id` 谁都能伪造。本期只做"我自己的项目能聚一起"，公网多租户上线前必须补真鉴权。

### 1.3 DeepSeek 客户端（代理的核心）

```ts
// lib/deepseek/client.ts
const ALLOWED = ['deepseek-chat', 'deepseek-reasoner']   // 模型白名单

async function callDeepSeek({ messages, model }) {
  const chosen = ALLOWED.includes(model) ? model : 'deepseek-chat'   // 非法/缺省 → chat

  // 直接 fetch DeepSeek 的 OpenAI 兼容端点，stream:true 让它流式返回
  return fetch(`${process.env.DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,  // key 只在这里出现
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: chosen, messages, stream: true }),
  })
  // 注意：返回的是原始 fetch Response，它的 body 是一个可读流，
  // 我们不在这里 await 读完，而是把流原样交给上层透传给前端。
}
```

---

## 2. 数据库表结构

四张表，关系：`projects 1—N project_files`、`projects 1—N conversations 1—N messages`。

> **🗑 软删（v0.2 补充，覆盖下方所有表/接口）**：四表均加 `deleted_at timestamptz`（null=存活）。约定见 `docs/backend-todo.md` S3 "软删约定"——① 所有读 `WHERE deleted_at IS NULL`；② 删除动作通过 `POST + action=delete` 实现为 `UPDATE … SET deleted_at=now()` 并级联软删子表，不再依赖下文的硬删 CASCADE；③ `project_files` 的 `UNIQUE(project_id, path)` 改为**部分唯一索引** `WHERE deleted_at IS NULL`（否则软删后重建同名 path 撞约束）。下方建表 SQL 以最终 schema（`lib/db/schema.ts`）为准。

```sql
-- 项目（owner_id 用来做数据隔离）
CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    text NOT NULL,
  title       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_owner ON projects(owner_id);

-- 代码文件（一期只有一行 path='App.jsx'，结构本身支持二期多文件）
CREATE TABLE project_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path        text NOT NULL,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, path)            -- 同项目内 path 唯一，支持 upsert
);

-- 会话（一个项目可以有多轮独立会话）
CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 消息（完整 agent transcript：user / assistant / tool / system）
CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq              bigint GENERATED ALWAYS AS IDENTITY,   -- 全局自增，Postgres 原子分配
  role             text NOT NULL,           -- 'user' | 'assistant' | 'tool' | 'system'
  content          text NOT NULL,
  model            text,                    -- 该条 AI 回复用了哪个模型（assistant 才有）
  meta             jsonb,                   -- 工具结果的结构化细节（error stack、第几次尝试…）
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, seq);
```

> **多实例关键**：`seq` 用 `GENERATED ALWAYS AS IDENTITY`（全局自增），**不是**"会话内 MAX+1"。因为 Vercel 多实例并发写时，"先查 MAX 再 +1"会两个实例抢到同一个号。交给 Postgres 的 identity 序列原子分配，天生无竞态。它只用于"会话内排序"，不连续（有跳号）无所谓，`ORDER BY seq` 顺序仍确定。

**为什么 messages 要存 `role='tool'`？** 因为自我修复闭环里，沙箱回传的 `RUNTIME_ERROR` 也是对话的一部分——AI 下一轮要读它才能改。把它落库，整个"AI 试了 3 次才跑通"的过程就是可回放的事实。

```ts
// lib/db/schema.ts —— drizzle 写法（和上面 SQL 一一对应）
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({ ownerIdx: index('idx_projects_owner').on(t.ownerId) }))
// project_files / conversations / messages 同理…
```

---

## 3. 接口总览

| # | 方法 路径 | 用途 | 流式 |
|---|---|---|---|
| 1 | `POST /api/chat` | 读历史拼上下文→代理 DeepSeek→落库 user+assistant，流式返回 | ✅ SSE |
| 2 | `GET /api/projects` | 列出我的项目 | |
| 3 | `POST /api/projects` | 新建项目 | |
| 4 | `GET /api/projects/[id]` | 取单个项目（含文件） | |
| 5 | `POST /api/projects/[id]` | 项目改名，body.action = `rename` | |
| 6 | `POST /api/projects/[id]` | 删项目，body.action = `delete` | |
| 7 | `GET /api/projects/[id]/files` | 取项目代码文件 | |
| 8 | `POST /api/projects/[id]/files` | 整体写入/更新代码文件 | |
| 9 | `GET /api/projects/[id]/conversations` | 列会话 | |
| 10 | `POST /api/projects/[id]/conversations` | 新建会话 | |
| 11 | `GET /api/conversations/[id]/messages` | 取消息（按 seq 排序） | |
| 12 | `POST /api/conversations/[id]/messages` | 追加一条消息 | |

---

## 4. 接口详解

### ① POST /api/chat —— LLM 流式代理（重点中的重点）

**用途**：agent loop 每一轮都调它。前端只发"会话 id + 这一轮的新内容"，**后端自己从 DB 读历史、拼上下文、调 DeepSeek、把 user 和 assistant 两条都落库**，并把 AI 输出**边产生边流式吐回**前端。

**为什么上下文必须后端拼（不能前端拼）**：这是真实项目的硬约束，不是偷懒能省的——
1. **system prompt 不能给前端**：提示词是核心资产，前端拼上下文等于把它暴露在浏览器里。
2. **上下文不能让前端说了算**：前端不可信，它发什么后端就喂 LLM 什么 = 把"AI 看到什么"的控制权交给攻击面。
3. **DB 是 transcript 唯一权威**：让前端另攒一份 messages，迟早和库不一致。后端每次从库重建，单一数据源。

所以 `/api/chat` 是**有状态的**（它读写 DB），不是纯代理。

**请求**
```http
POST /api/chat
Content-Type: application/json
x-owner-id: <uuid>

{
  "projectId": "uuid",               // 必传，会话挂在哪个项目下（懒建会话时用）
  "conversationId": "uuid",          // 可选！没传 → 后端新建会话并经 SSE init 事件回传 id
  "role": "user",                    // 'user'（新需求）或 'tool'（沙箱报错反馈）
  "content": "做一个待办列表",
  "model": "deepseek-chat",          // 可选，缺省 deepseek-chat
  "meta": { }                        // 可选，role=tool 时放 error stack / attempt
}
```
> 前端**不传 messages**——它根本不持有历史。只说"在这个会话里，我这轮要说这句"。
> **会话懒创建**：前端首次对话不带 `conversationId`，后端用 `projectId` 建新会话，并在 SSE 流最前面发一条 `{ "type":"init", "conversationId":"<新id>" }` 回传；前端记下，之后每轮带着它。"新会话" = 前端清掉 id。**因此没有独立的"建会话"接口（原 ⑩ 删）。**

**响应**：SSE 流（`text/event-stream`），每个分片是 DeepSeek 原样的 chunk：
```
data: {"choices":[{"delta":{"content":"import"}}]}

data: [DONE]
```
> `deepseek-reasoner` 还会多一条 `reasoning_content`（思考过程），与 `content` 分通道，前端自己决定展不展示。

**实现步骤**
1. `runtime='nodejs'`、`dynamic='force-dynamic'`（关掉缓冲，否则流被聚合）。
2. zod 校验 + owner 校验（这个会话是不是当前 owner 的）。
3. **先把这次输入落库**（user 的需求 / tool 的报错），保证 transcript 完整。
4. **从 DB 重建上下文**：读这个会话所有消息 → 转成 LLM 能吃的 messages（含 system prompt）。
5. 调 `callDeepSeek`（stream:true）；上游报错 → 透传状态码，不吞。
6. **一边转发流给前端，一边在服务端攒完整 assistant 文本**；流结束后把 assistant 回复落库。

**伪代码**
```ts
// app/api/chat/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ChatSchema = z.object({
  projectId: z.string().uuid(),                   // 必传：懒建会话挂在它下面
  conversationId: z.string().uuid().optional(),   // 可选：没传就新建，新 id 经 SSE init 回传
  role: z.enum(['user', 'tool']),                 // 只有这两种是"输入"
  content: z.string().min(1),
  model: z.string().optional(),
  meta: z.any().optional(),
})
// 解析会话：conversationId 在 → 校验归属取用；不在 → insert conversations(projectId) 拿新 id（created=true）
// SSE 最前面：if (created) 发 { type:'init', conversationId }

export async function POST(req) {
  const ownerId = requireOwner(req)
  const body = ChatSchema.parse(await req.json())
  await assertOwnsConversation(body.conversationId, ownerId)   // 不是你的会话 → 404

  // 3. 先落库这次输入（user 需求 或 tool 报错）
  await appendMessage(body.conversationId, {
    role: body.role, content: body.content, meta: body.meta,
  })

  // 4. 从 DB 重建完整上下文（后端是上下文的唯一权威）
  const stored = await db.select().from(messages)
    .where(eq(messages.conversationId, body.conversationId))
    .orderBy(asc(messages.seq))
  const llmMessages = [
    { role: 'system', content: SYSTEM_PROMPT },   // ← system prompt 在服务端，前端看不到
    ...toLLMMessages(stored),                      // ← tool 消息转成 user，见下
  ]

  // 5. 调 DeepSeek 流式
  const upstream = await callDeepSeek({ messages: llmMessages, model: body.model })
  if (!upstream.ok) return fail(upstream.status, 'deepseek error', await upstream.text())

  // 6. 转发流 + 服务端攒全文，结束后落库 assistant 回复
  import { waitUntil } from '@vercel/functions'
  let raw = ''
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value)                       // 原样转发给前端
          raw += decoder.decode(value, { stream: true })  // 同时在服务端攒
        }
      } catch (e) {
        const m = `event: error\ndata: ${JSON.stringify({ message: String(e) })}\n\n`
        controller.enqueue(new TextEncoder().encode(m))
      } finally {
        controller.close()
        const assistantText = parseSSEContent(raw)         // 从 SSE 抽出 delta.content 拼全
        if (assistantText) {
          // ★ 多实例关键：用 waitUntil 把"存 assistant"挂到函数生命周期上。
          //   否则响应流一结束 / 客户端一断开，serverless 实例可能被立刻冻结，
          //   finally 里的 await 来不及跑完 → assistant 回复丢失、transcript 残缺。
          waitUntil(appendMessage(body.conversationId, {
            role: 'assistant', content: assistantText,
            model: body.model ?? 'deepseek-chat',
          }))
        }
      }
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  })
}
```

> 学习点：和"纯代理"不同，这里后端**要 tap 一下流**（`raw += ...`）才能把完整回复存库。而在 serverless 多实例下，存库这步必须用 `waitUntil` 兜底——**不能假设响应发完后实例还活着**。这是有状态代理在 serverless 上的真实代价。

**两个公共 helper**

```ts
// lib/messages.ts —— 追加一条消息。多实例安全：seq 由 DB identity 原子分配，
// 不再读 MAX；复杂多语句写入可使用 db.transaction。
async function appendMessage(convId, { role, content, model, meta }) {
  const [m] = await db.insert(messages).values({
    conversationId: convId, role, content, model, meta,   // ← 不传 seq，DB 自动生成
  }).returning()
  return m
}

// lib/context.ts —— DB transcript 转成 LLM 能吃的 messages（在【后端】）
// 坑：库里有 role='tool'（沙箱报错），但 DeepSeek 不接受裸 tool role
//     （那是 function calling 才用的）。必须转成 user 消息喂回去。
function toLLMMessages(stored) {
  return stored.flatMap((m) => {
    if (m.role === 'user' || m.role === 'assistant')
      return [{ role: m.role, content: m.content }]
    if (m.role === 'tool')
      return [{ role: 'user', content: `上一版运行结果（请据此修复）：\n${m.content}` }]
    return []                                   // system 已在外层加，库里一般不存
  })
}
```

#### token 预算（后端的事）

历史越攒越长迟早超模型上下文窗口。本期先不优化（单文件小项目够用），二期在 `toLLMMessages` 之后加一层裁剪：超长就**截断旧消息**或 **summary 压缩**，只留 system + 最近 N 轮 + 当前代码。这一步也在**后端**做，前端无感。

---

### ② GET /api/projects —— 列出我的项目

**用途**：进首页时拉取当前 owner 的所有项目。

**请求**：无 body，带 `x-owner-id` 头。
**响应**：`{ ok:true, data: [ { id, title, createdAt, updatedAt }, … ] }`

**伪代码**
```ts
export async function GET(req) {
  const ownerId = requireOwner(req)                 // 缺头 → 400
  const rows = await db.select().from(projects)
    .where(eq(projects.ownerId, ownerId))
    .orderBy(desc(projects.updatedAt))              // 最近改的排前面
  return ok(rows)
}
```

---

### ③ POST /api/projects —— 新建项目

**用途**：用户开一个新 playground。可选带初始代码。

**请求**
```json
{ "title": "我的待办应用", "initialCode": "export default function App(){…}" }
```
**响应**：`201`，`{ ok:true, data: { id, title, … } }`

**实现步骤**：插 projects 一行 → 若给了 initialCode，再插 project_files 一行（path 固定 `App.jsx`）。

**伪代码**
```ts
const CreateSchema = z.object({ title: z.string().min(1), initialCode: z.string().optional() })

export async function POST(req) {
  const ownerId = requireOwner(req)
  const body = CreateSchema.parse(await req.json())

  const [project] = await db.insert(projects)
    .values({ ownerId, title: body.title }).returning()

  if (body.initialCode) {
    await db.insert(projectFiles)
      .values({ projectId: project.id, path: 'App.jsx', content: body.initialCode })
  }
  return ok(project, 201)
}
```

---

### ④ GET /api/projects/[id] —— 取单个项目（含文件）

**用途**：打开某个项目时，一次性拿到项目信息 + 它的代码文件。

**响应**：`{ ok:true, data: { id, title, files: [ { path, content }, … ] } }`
**owner 不符**：返回 `404`（不暴露"存在但不是你的"）。

**伪代码**
```ts
export async function GET(req, { params }) {
  const ownerId = requireOwner(req)
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, params.id), eq(projects.ownerId, ownerId)),
  })
  if (!project) return fail(404, 'project not found')      // 不存在 or 不是你的，统一 404

  const files = await db.select().from(projectFiles)
    .where(eq(projectFiles.projectId, params.id))
  return ok({ ...project, files })
}
```

---

### ⑤ POST /api/projects/[id] —— 改名

**请求**：`{ "action": "rename", "title": "新名字" }`
**伪代码**
```ts
export async function POST(req, { params }) {
  const ownerId = requireOwner(req)
  const { title } = z.object({
    action: z.literal('rename'),
    title: z.string().min(1),
  }).parse(await req.json())
  const updated = await db.update(projects)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(projects.id, params.id), eq(projects.ownerId, ownerId)))   // owner 也进 where
    .returning()
  if (updated.length === 0) return fail(404, 'project not found')
  return ok(updated[0])
}
```
> 学习点：owner 校验直接写进 `where`，改不到就是 0 行——一句 SQL 同时完成"鉴权 + 更新"，不用先查再改。这叫"消除特殊情况"。

---

### ⑥ POST /api/projects/[id] —— 删项目

**用途**：删项目，连带它的文件、会话、消息全删。
**实现**：只删 projects 一行，子表靠外键 `ON DELETE CASCADE` 自动清。
**伪代码**
```ts
export async function POST(req, { params }) {
  const ownerId = requireOwner(req)
  z.object({ action: z.literal('delete') }).parse(await req.json())
  const deleted = await db.delete(projects)
    .where(and(eq(projects.id, params.id), eq(projects.ownerId, ownerId)))
    .returning({ id: projects.id })
  if (deleted.length === 0) return fail(404, 'project not found')
  return ok({ deleted: params.id })          // 文件/会话/消息 由 CASCADE 自动删
}
```

---

### ⑦ GET /api/projects/[id]/files —— 取代码文件

**用途**：单独拉某项目的代码（④ 已含文件，这个接口给"只刷新代码"的场景）。
**伪代码**
```ts
export async function GET(req, { params }) {
  const ownerId = requireOwner(req)
  await assertOwns(params.id, ownerId)        // 见下方 helper，不是你的就抛 404
  const files = await db.select().from(projectFiles)
    .where(eq(projectFiles.projectId, params.id))
  return ok(files)
}
```

```ts
// lib/guard.ts —— 复用的归属校验
async function assertOwns(projectId, ownerId) {
  const p = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)),
  })
  if (!p) throw new HttpError(404, 'project not found')
}
```

---

### ⑧ POST /api/projects/[id]/files —— 写入/更新代码

**用途**：AI 生成新代码、或用户手改代码后，整体存盘。

**请求**
```json
{ "action": "write", "files": [ { "path": "App.jsx", "content": "…新代码…" } ] }
```
**实现**：对每个文件做 **upsert**（有则更新 content，无则插入），靠 `UNIQUE(project_id, path)` 约束。顺手更新项目的 `updated_at`。

**伪代码**
```ts
const PostFilesSchema = z.object({
  action: z.literal('write'),
  files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
})

export async function POST(req, { params }) {
  const ownerId = requireOwner(req)
  await assertOwns(params.id, ownerId)
  const { files } = PostFilesSchema.parse(await req.json())

  for (const f of files) {
    await db.insert(projectFiles)
      .values({ projectId: params.id, path: f.path, content: f.content })
      .onConflictDoUpdate({                                  // ← upsert 关键
        target: [projectFiles.projectId, projectFiles.path],
        set: { content: f.content, updatedAt: new Date() },
      })
  }
  await db.update(projects).set({ updatedAt: new Date() })
    .where(eq(projects.id, params.id))                       // 项目时间也刷新，列表好排序
  return ok({ saved: files.length })
}
```

---

### ⑨ GET /api/projects/[id]/conversations —— 列会话

**伪代码**
```ts
export async function GET(req, { params }) {
  const ownerId = requireOwner(req)
  await assertOwns(params.id, ownerId)
  const rows = await db.select().from(conversations)
    .where(eq(conversations.projectId, params.id))
    .orderBy(desc(conversations.createdAt))
  return ok(rows)
}
```

### ⑩ POST /api/projects/[id]/conversations —— 新建会话（❌ 本期删除）

> **不实现**：会话改为由 `/api/chat`（①）懒创建（不带 conversationId 即新建，经 SSE `init` 回传 id）。"新会话" = 前端清 id 即可，无需独立端点。下方伪代码留作将来参考（若以后要"建空会话"再启用）。

**用途**：开始一轮新对话（比如用户清空重聊）。
**伪代码**
```ts
export async function POST(req, { params }) {
  const ownerId = requireOwner(req)
  await assertOwns(params.id, ownerId)
  const { title } = z.object({ title: z.string().optional() }).parse(await req.json())
  const [conv] = await db.insert(conversations)
    .values({ projectId: params.id, title }).returning()
  return ok(conv, 201)
}
```

---

### ⑪ GET /api/conversations/[id]/messages —— 取消息

**用途**：恢复一轮会话的完整 transcript（刷新页面后接着聊）。
**注意**：URL 里只有 conversationId，要**反查**它属于哪个 project、那个 project 是不是当前 owner 的。

**响应**：按 `seq` 升序的消息数组（顺序确定，能完整回放 AI 修复过程）。
**伪代码**
```ts
export async function GET(req, { params }) {
  const ownerId = requireOwner(req)
  await assertOwnsConversation(params.id, ownerId)          // 会话 → 项目 → owner 三级校验
  const rows = await db.select().from(messages)
    .where(eq(messages.conversationId, params.id))
    .orderBy(asc(messages.seq))
  return ok(rows)
}
```

```ts
// lib/guard.ts —— 经会话反查归属
async function assertOwnsConversation(convId, ownerId) {
  const row = await db.select({ ownerId: projects.ownerId })
    .from(conversations)
    .innerJoin(projects, eq(conversations.projectId, projects.id))
    .where(eq(conversations.id, convId))
    .limit(1)
  if (row.length === 0 || row[0].ownerId !== ownerId) {
    throw new HttpError(404, 'conversation not found')
  }
}
```

---

### ⑫ POST /api/conversations/[id]/messages —— 追加消息（非 AI 写入）

**用途**：**注意 agent 主流程不用它**——chat 的 user/assistant/tool 三类消息全由 `/api/chat`（①）内部用 `appendMessage` 落库，避免两条写路径。这个公开端点留给"不触发 AI 的写入"，比如用户手动编辑代码后记一条 note、导入历史。本期可不实现，列出保持完整。

**实现**：就是把公共 helper `appendMessage`（见 ①）包成一个 HTTP 端点。
```ts
const MsgSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  content: z.string(),
  model: z.string().optional(),
  meta: z.any().optional(),
})

export async function POST(req, { params }) {
  const ownerId = requireOwner(req)
  await assertOwnsConversation(params.id, ownerId)
  const body = MsgSchema.parse(await req.json())
  const msg = await appendMessage(params.id, body)   // 复用 ① 的 identity seq 写入
  return ok(msg, 201)
}
```

> 学习点：`appendMessage` 写一次，`/api/chat` 和这个端点都复用——**一个写库逻辑只有一处**，不重复实现 seq 计算。

---

## 5. 这些接口怎么拼成 agent loop（前端，给你建立整体感）

下面是前端伪代码，让你看清后端 12 个接口在真实 agent 里怎么被调用。**这就是本项目的"灵魂"**：

```ts
// 前端 B 域：手写的 agent loop（不用 LangChain）
// 注意：前端【不持有 messages 数组】。上下文是后端的事。
// 前端每轮只做四件事：发这轮的 turn → 流式显示 → 跑沙箱 → 把结果作为下一轮 turn。
async function runAgent(projectId, convId, userPrompt) {
  let turn = { role: 'user', content: userPrompt }   // 第一轮：用户需求

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // (1) 发这一轮给 /api/chat。后端自己：读历史→拼上下文→调AI→把 user+assistant 落库。
    //     前端只拿到流式吐回的代码（streamChat 解析 SSE 的 delta.content 拼成全文）。
    const code = await streamChat('/api/chat', { conversationId: convId, ...turn })

    // (2) 存代码到项目文件
    await api.put(`/api/projects/${projectId}/files`,
      { files: [{ path: 'App.jsx', content: code }] })

    // (3) 丢进 iframe 沙箱执行（C 域，浏览器内，不走后端）
    const result = await runInSandbox(code)   // iframe 回传 RENDER_OK / RUNTIME_ERROR

    // (4) 跑通了就结束；跑挂了把报错作为【下一轮 turn】发回去
    if (result.type === 'RENDER_OK') return { ok: true, attempt }
    turn = {
      role: 'tool',                                   // 后端会落库为 tool，并转成 user 喂 AI
      content: `RUNTIME_ERROR: ${result.error}`,
      meta: { type: result.type, stack: result.stack, attempt },
    }
    // 继续 for 循环 —— 这就是「自我修复闭环」
  }
  return { ok: false, reason: '到达最大尝试次数仍未跑通' }
}
```

**对照着看**（B 架构下职责怎么分）：
- **前端**只管"驱动循环 + 跑沙箱 + 决定继续/停止"——因为沙箱在浏览器，循环天然在前端。
- **后端 `/api/chat`** 管"记忆（读写 transcript）+ 拼上下文 + 调 AI"——数据和提示词的权威。
- 前端发的每个 `turn` 极小（一句话 + 会话 id），**完整历史从不经过前端**。
- `messages` 表是唯一事实源；刷新页面后用 `GET messages`（⑪）把对话重新画到 UI 上，但 AI 的记忆始终由后端从库重建，不依赖前端。

**搞懂这个分工，就搞懂了真实 agent 后端的本质**：前端是"手和眼"，后端是"记忆和嘴"。

---

## 6. 文件结构

```
app/
  api/
    chat/route.ts                              # ① 流式代理
    projects/route.ts                          # ②③
    projects/[id]/route.ts                     # ④⑤⑥
    projects/[id]/files/route.ts               # ⑦⑧
    projects/[id]/conversations/route.ts       # ⑨⑩
    conversations/[id]/messages/route.ts       # ⑪⑫
lib/
  http.ts                                      # ok() / fail() / HttpError
  owner.ts                                     # requireOwner()
  guard.ts                                     # assertOwns / assertOwnsConversation
  deepseek/client.ts                           # callDeepSeek()
  db/
    schema.ts                                  # drizzle 表定义
    index.ts                                   # db 客户端（pg 连接池）
    migrations/                                # drizzle-kit 生成的 .sql
drizzle.config.ts
```

---

## 7. 错误处理统一出口（已弃用，见 backend-todo S6/S14 决策）

> 当前不抽 `route()` wrapper，每个接口内联 try/catch。下文留作将来参考。

每个 route 里 try/catch 太啰嗦，包一个 wrapper：

```ts
// lib/route.ts
function route(handler) {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message)
      if (e instanceof ZodError)  return fail(400, 'validation failed', e.issues)
      console.error(e)                          // 真·500 才打日志（注意别打到 key）
      return fail(500, 'internal error')
    }
  }
}
// 用法： export const GET = route(async (req) => { … })
```

这样每个接口只管正常逻辑，抛 `HttpError(404, …)` 就行，错误格式全局统一。

---

## 8. 多实例 / Serverless 设计约束（Vercel 部署的硬前提）

Vercel 把每个请求路由到**无状态、可随时拉起/杀掉、互不共享内存**的函数实例。多实例不是"以后再说"，是设计时就得满足的前提。本方案为此做了 4 件事：

| 风险（多实例下会坏） | 本方案的做法 |
|---|---|
| **内存状态丢失**：实例不共享内存，把上下文/会话存在内存里换实例就没了 | 后端**无内存状态**，每次从 DB 重建上下文（见 ①）。DB 是唯一事实源。 |
| **seq 竞态**：两实例并发"读 MAX 再 +1"会抢到同一个号 | `seq` 用 Postgres `GENERATED ALWAYS AS IDENTITY` **原子分配**，不读 MAX、不用事务（见表结构 / `appendMessage`）。 |
| **响应后实例被冻结**：`finally` 里的 DB 写可能来不及跑，assistant 回复丢失 | 存 assistant 用 **`waitUntil()`** 挂到函数生命周期（见 ①）。 |
| **连接数被打爆**：每实例开普通 TCP 连接池，Postgres `max_connections` 撑不住 | 用 **Neon serverless WebSocket Pool** 支持事务，同时避免普通 `pg` 连接池问题（见技术栈表）。 |

```ts
// lib/db/index.ts —— 支持事务的 Neon serverless DB 客户端
import ws from 'ws'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

neonConfig.webSocketConstructor = ws

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
export const db = drizzle({ client: pool, schema })
```

> 还要注意：**Vercel 函数有最大执行时长**（Hobby 默认较短）。我们的 agent loop 是**多次独立的 `/api/chat` 调用**（每次只生成一版代码），单次都很短，不会撞上限——这也是"循环放前端、每轮一次请求"的额外好处。若以后要单请求内长时间流式，需开 Fluid Compute 或调 `maxDuration`。

> `neon-http` 驱动不支持交互式事务。当前实现已切到 `neon-serverless` WebSocket `Pool`，需要多语句一致性的路径应直接使用 `db.transaction(...)`。

---

## 附：开放问题（实现前定一下）

- **一期要不要多项目列表**：schema 支持，前端可以先只用一个隐式项目，以后再加项目管理 UI。
- **system prompt 放哪**：放后端 `lib/prompts.ts`（**不能放前端**，理由见 ①），不入库。
- **maxDuration**：上线前确认 Vercel 计划的函数时长够 DeepSeek 单次生成（一般够；reasoner 慢，留意）。
