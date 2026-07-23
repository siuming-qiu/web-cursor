# Roadmap —— 从可靠 Agent Harness 到可观察多 Agent

> Status: active design roadmap；除“当前基线”中明确标记完成的能力外，均非当前实现。
> Revised: 2026-07-23。
> Current baseline: `305ae34`。
> 产品目标：把 Web Cursor 从“会生成并运行 React 项目”升级为“能够可靠完成多文件编码任务、并可逐步组织 Sub-agent 协作的编码 Agent”。
> 学习目标：手写理解 context / harness / run lifecycle / eval / observability / compaction / multi-agent / memory，不引入 LangChain 系框架。

## 1. 定位与北极星

本路线解决的不是“怎样让模型显得更聪明”，而是怎样让模型在一个可约束、可恢复、可验证的 Agent Harness 中持续工作。

这里所说的 Harness 包含五类能力：

1. **Context**：当前模型真正需要看到什么。
2. **Tools**：模型能够执行什么，以及参数和结果的严格契约。
3. **Constraints**：预算、权限、revision、并发和停止围栏。
4. **Validation**：怎样用代码、构建和运行证据判断任务是否完成。
5. **Correction**：失败后怎样重试、重新读取、重新规划或明确停止。

ContextAssembler、ContextCheckpoint、Memory 和 Sub-agent 都属于这个 Harness，不能各自独立演进。

### 1.1 最终验收靶子

Agent 能在一个 100+ 文件的真实 React 项目中：

1. 在不知道目标文件路径时定位相关实现。
2. 完成跨多个文件的功能修改。
3. 不覆盖用户并发修改，不把用户写错的代码归因给 Agent。
4. 通过项目明确声明的 typecheck、build 和浏览器预览验证。
5. 发生自身引入的错误时自动修复；达到预算或遇到冲突时明确停止。
6. 真正停止后续 LLM 和工具调用，刷新后仍能恢复权威进度。
7. 用户能够看到 Manager 与 Sub-agent 正在执行的任务、工具、文件、证据和阻塞原因。
8. 支持回放和撤销本次 Agent 修改，但不覆盖任务结束后的用户修改。

### 1.2 核心指标

| 类型 | 指标 | 说明 |
|---|---|---|
| 目标指标 | 任务成功率 | 固定任务集最终通过全部验收的比例，作为北极星 |
| 目标指标 | 可验证完成率 | 最终声明完成的任务中，具备有效验证证据的比例 |
| 安全护栏 | 非预期写入率 | 停止后写入、冲突覆盖、重复 mutation 必须为 0 |
| 安全护栏 | 错误归因准确率 | Agent 错误进入自修；用户错误不自动触发 Agent |
| 恢复指标 | Run 恢复成功率 | 断线、刷新或异步等待后恢复到正确状态的比例 |
| 效率指标 | 首次成功耗时 | 从用户发送需求到第一次完整验证通过 |
| 效率指标 | 工具与上下文成本 | LLM/tool 调用数、token、耗时、读写字符数和 Sub-agent 成本 |
| 多 Agent 指标 | 协作增益 | 相比同任务单 Agent，成功率提升是否覆盖额外延迟和成本 |

机制指标不能代替目标指标。例如 prompt cache hit、压缩次数、Sub-agent 数量只能解释系统怎样运行，不能证明任务已经完成。

## 2. 已确定的路线决策

### 2.1 先做什么

```text
Harness 身份与基线
    ↓
严格 Context 协议
    ↓
持久 AgentRun / Stop / Restore
    ↓
确定性 RunProjection / 进度 UI
    ↓
工具可靠性 / ChangeSet / Verifier
    ↓
ContextCheckpoint / 分层压缩
    ↓
Manager + Sub-agent
    ↓
有证据后再做长期 Memory
```

### 2.2 不把 Memory 当作多 Agent 前置

- Transcript 是当前会话的原始事件记录。
- AgentRun 是一次执行的权威生命周期。
- RunProjection 是由结构化事实计算出来的当前状态。
- ContextCheckpoint 是对已结束旧历史的上下文压缩。
- RevisionCheckpoint 是代码版本/回滚点；它与 ContextCheckpoint 不是同一种数据。
- Memory 是跨任务、跨会话的长期知识。

同一任务内的 Sub-agent 协作需要的是明确任务包、repository identity、Artifact、Evidence 和父子 Run 状态，不需要先建设长期 Memory。

### 2.3 多 Agent 是目标能力，但必须分阶段开放

目标架构从一开始就是完整的 Manager 模式，不建设“多个模型共享完整上下文并自由群聊”的临时方案。

第一批只开放只读 Explorer，随后开放具备独立外部证据的 Verifier，最后才开放写代码的 Worker。分阶段开放是为了验证生命周期、冲突和恢复机制，不代表设计一个无法扩展的简化架构。

## 3. 当前基线（2026-07-23，`305ae34`）

### 3.1 已完成

- Postgres 持久化项目、会话和 transcript。
- 手写服务端 Agent loop，支持文件读取、搜索、修改、预览、附件和图片工具。
- 浏览器运行错误可以回填 Agent，形成首屏自修闭环。
- `search_text` 提供有界、大小写敏感、单行字面量搜索。
- Stop 已能中止当前浏览器请求和正在进行的 LLM stream，并在工具轮次边界检查 abort。
- 项目代码已经抽象为 `ProjectRepository`，支持 Database 与 BrowserGit 两种 storage kind。
- BrowserGit 已提供浏览器内 Git repository、Source Control UI、repository/project 级全局 revision CAS 和存储迁移。
- 图片生成已经从浏览器轮询启动改为 `after()` 启动的后台 worker。
- 已有 BrowserGit 存储契约、多 Agent 目标架构和 Grok Build 演进参考文档。

### 3.2 已核实的断裂点

| # | 断裂点 | 当前后果 |
|---|---|---|
| 1 | 没有一等、持久的 AgentRun | 一次任务仍被拆成多个 HTTP 请求，无法可靠恢复、取消和计量 |
| 2 | system prompt、toolset、model、locale 没有冻结的协议身份 | 同一个 Run 跨部署恢复时可能静默换协议 |
| 3 | transcript 仍全量投影，tool arguments 仍存在空对象兜底 | 长会话持续膨胀；畸形输入可能被伪装成合法调用 |
| 4 | Stop 没有持久取消围栏，工具 executor 也没有 Run/lease/signal | 已经开始的工具可能完成副作用；刷新后无法确认停止结果 |
| 5 | 没有统一 RunProjection | 模型状态、聊天 activity 和用户进度可能互相漂移 |
| 6 | 客户端 mutation 没有 durable receipt，Git stage/unstage/commit 没有独立 Git state token | 操作成功但结果未回传时，无法安全判断是否应该重放 |
| 7 | 图片 worker 缺少 AgentRun gate、持久 heartbeat 和部署 drain | 不能可靠处理父任务取消、worker 重启和迟到结果 |
| 8 | BrowserGit 的代码只存在浏览器 Worker/IndexedDB | 页面离线时，服务端 Sub-agent 无法访问或继续修改项目 |
| 9 | storage migration 没有与非终态 AgentRun 互斥 | Run 执行期间切换代码权威来源会破坏 repository identity |
| 10 | 没有正式 ContextCheckpoint、Compactor、Run trace 和配对 eval | 无法证明压缩或多 Agent 是否真正改善任务结果 |

这些断裂点的优先级高于继续扩展 LSP、向量检索、长期 Memory 或并行写入型 Sub-agent。

## 4. 权威数据与目标架构

### 4.1 权威边界

| 数据 | 权威来源 | 禁止做法 |
|---|---|---|
| 当前代码 | 当前 `ProjectRepository` 及其 action-time revision | 从旧消息、ContextCheckpoint 或 UI 快照猜当前代码 |
| 原始对话 | append-only Transcript | 为了省事改写历史消息 |
| 执行状态 | AgentRun + 持久事件/工具记录 | 扫描最后一条聊天消息猜进度 |
| 当前进度 | 由代码计算的 RunProjection | 让 LLM 自己维护计数或状态 |
| 历史摘要 | ContextCheckpoint | 把摘要中的代码事实当作当前真相 |
| 长期知识 | versioned Memory record | 静默写入、冲突覆盖或无法删除 |
| 完成状态 | Verifier 产生的结构化证据 | 仅依据模型回复“已完成” |

`workspace.descriptor` 和 React state 只能用于界面展示或初始化。任何 mutation、resume 或 Sub-agent handoff 都必须在 action time 从真正的 repository owner 读取 storage kind、repository identity 和当前 revision。

### 4.2 目标关系

```text
Project ── ProjectRepository ── Revision / ChangeSet / Artifact
   │
Conversation ── AgentRun ── RunEvent / ToolCall / Evidence
                    │
                    ├── RunProjection ── Model Status
                    │                 └── User Progress UI
                    │
                    └── Child AgentRun ── Child Transcript / Result
```

这是概念关系，不是数据库字段契约。具体字段、状态枚举、索引和迁移必须在唯一实施指南中引用权威契约后定义，禁止实现时猜 schema。

### 4.3 Context 静态前缀必须具有身份

一个 AgentRun 创建时冻结：

- locale；
- system prompt profile、版本和渲染 digest；
- toolset profile、版本、顺序、schema digest；
- model profile 和版本；
- repository/storage capability profile。

Resume 只能解析并使用该 Run 已冻结的身份。身份版本不存在或 digest 不匹配时必须 fail closed，不能自动使用当前部署的最新版。

### 4.4 多 Agent 的控制面与数据面

- **控制面**：父子 Run、任务依赖、状态、预算、lease、heartbeat、cancel、result。
- **数据面**：Repository、ChangeSet、Artifact、Evidence 和显式文件引用。

第一版不建设自由消息总线。Manager 通过持久任务和有限消息类型协调 Child；Child 不直接写用户主会话，也不直接和其他 Child 自由聊天。

## 5. 迭代路线

### P-1 —— Baseline 与 Harness Identity

**目标**：改变 Agent 行为前，先冻结可复查的起点和协议身份。

工作项：

- 记录 `305ae34` 下的固定任务、模型、prompt、toolset、locale、storage kind、代码版本、结果和已知失败。
- 固定覆盖 Database、BrowserGit、运行错误自修、异步图片、Stop、客户端工具恢复和 revision conflict 的最小任务集。
- 定义 versioned prompt/toolset/model profile registry 和 canonical digest 规则。
- Baseline 和每次 shadow 对比显式记录完整静态前缀身份，不再只记一个模型名称。
- 记录 provider prompt cache hit/miss；provider 没有返回时记为未知，不猜成 0。
- 只收集评分和诊断需要的信息，不保存完整源码、密钥或不必要的用户内容。

验收：

- 同一 profile identity 在相同输入下产生完全相同的 system prompt、工具顺序、schema 和模型配置。
- 未知 profile/version 明确失败并给出诊断。
- Baseline 可以重复执行并区分目标指标、机制指标和安全护栏。

### P0 —— 严格 Transcript 与 FullContextAssembler

**目标**：先建立行为等价、可诊断的 Context 协议，再做任何裁剪和压缩。

工作项：

- 分离领域消息、内部技术消息和 provider message，不再仅凭 `role` 猜业务语义。
- 严格校验 assistant tool call 与 tool result 的身份和闭合关系。
- 删除缺失 tool arguments 时注入 `"{}"` 的兜底；非法 JSON、未知结构和缺失字段直接失败。
- 实现 `FullContextAssembler`：仍投影完整合法历史，不改变模型可见内容。
- 新旧投影做 shadow diff，验证 tool pairing、顺序和内容等价。
- 为后续技术状态消息预留独立 domain type；即使 provider API 最终要求某个 role，也不能把它当真实用户请求。

验收：

- 每个 tool call 恰好有一个合法闭合结果。
- 畸形 transcript 不进入模型请求，并带有可定位的错误。
- Shadow 阶段不改变现有任务结果。

### P1 —— 持久 AgentRun、Stop 与 Restore

**目标**：让一次任务拥有独立于 HTTP/SSE 的权威生命周期。

工作项：

- 定义并持久化 AgentRun、attempt、lease、预算、终态和必要事件。
- AgentRun 创建时持久化 P-1 定义的完整静态前缀身份；Resume 只能解析该身份，版本缺失或 digest 不匹配时 fail closed。
- 建立最小 append-only tool invocation ledger、唯一闭合约束和 replay fence；执行 mutation 前先持久化调用身份。
- 模型轮数、工具轮数、token 和时间预算归属于 Run，不随 HTTP resume 重新计数。
- SSE 只负责实时传输；刷新和断线恢复从持久状态开始。
- Stop 先写持久取消围栏，再取消当前 transport；executor 在开始工具、写入结果和继续模型前检查精确 Run/attempt/lease。
- 已取消或旧 attempt 的迟到结果只进入诊断，不继续推进 transcript。
- 异步工具使用“启动任务 → 持久等待 → terminal event → ready to resume”的生命周期。
- storage migration 与同项目所有非终态 AgentRun 做服务端互斥，不能只依赖 UI 禁用。
- 明确 BrowserGit Run 的 client-bound 能力：浏览器执行域不在线时进入等待或失败，不能伪装成后台继续。

Stop 是执行围栏，不是回滚。已经提交成功的 mutation 可以保留，但停止后不得开始新的 LLM 调用或工具副作用。

P1 只保证恢复时不会盲目重放无法证明结果的 mutation：如果调用可能已经产生副作用但尚无权威 receipt，Run 必须进入明确阻塞并等待 reconcile。P3 完成 durable receipt 后，才承诺自动判定已有结果并安全恢复。

验收：

- “发送 → Stop → 刷新 → 再发送”不会出现旧 Run 的新工具或新模型轮次。
- 同一个 mutation tool call 被恢复时不会被盲目执行第二次；无法证明结果时明确阻塞。
- 图片或浏览器工具跨请求完成后可以恢复原 Run，而不是新建一段猜测性的流程。

### P2 —— RunProjection、进度 UI 与最小 Trace

**目标**：让模型和用户看到同一份由事实计算出的当前状态。

工作项：

- V1 只从 P1 已有的 AgentRun、tool invocation ledger 和 action-time repository descriptor 计算确定性 RunProjection。
- V1 只展示当前 Run、attempt、预算、工具闭合/等待、取消、恢复和阻塞事实，不提前猜计划、Artifact 或验证状态。
- P3/P4/P8 建立 ChangeSet、Evidence 和任务契约后，再通过版本化 projection schema 增加文件、验证、计划/TODO 和 Child 进度。
- Projection 作为 assembly-only 技术消息进入 Context，不写成真实用户消息，也不修改 Transcript。
- 用户界面使用同一份 Projection 显示运行状态；刷新后从统一 restore snapshot 重建。
- 只展示当前阶段已有权威来源的状态和安全摘要，不展示隐藏思维链。
- 建立 run/model/tool span：身份、时间、耗时、结果码、重试、revision 前后值和安全摘要。
- 为上下文、工具和 Sub-agent 变更建立配对 eval 与全局 kill switch。

验收：

- UI 和模型不会对“正在等待、已停止、已完成”产生不同判断。
- V1 trace 能回答某一步调用了什么工具、是否闭合，以及为什么等待、取消或阻塞。
- 只有具备明确总单元时显示 `2/4`；不伪造百分比进度。

### P3 —— 工具可靠性、Durable Receipt 与 ChangeSet

**目标**：工具副作用可以被安全重试、恢复、归因和撤销。

工作项：

- 所有工具参数保持原样，严格 schema 校验；禁止 normalize 未知字段、enum 或结构。
- 大型工具结果使用明确分页、截断和 Artifact 引用，不把无限日志或源码塞入 Context。
- Mutation 使用幂等身份和持久 receipt，解决“操作成功但结果未写回”的不确定窗口。
- repository/project 级全局 revision 与 Git index/HEAD state 分开建模；不能用 project revision 猜 Git 操作是否执行。
- 增加精确 `edit_file`：目标旧文本必须恰好匹配一次并携带权威 revision；0 次、多次或冲突都失败。
- 一次 AgentRun 的成功修改形成 ChangeSet，支持归因、验证和条件回滚。
- 按结构化错误分类决定是否重试；部分 stream 已产生业务结果时不得静默重放。
- 记录相同工具名、原始参数和相同错误的无进展指纹，再用 eval 校准熔断阈值。
- 在隔离写入上线前，同一 repository 同时最多一个写入者。

验收：

- mutation、client result 或 Git result 重复提交不会产生第二次副作用。
- revision conflict 后必须重新读取并重新规划，不能重放旧写。
- 未知工具字段和无法证明的副作用状态明确阻塞，不猜成功或失败。

### P4 —— Verifier 与 Preview v2

**目标**：由外部证据决定是否完成，而不是由模型自评。

验证顺序：

```text
严格静态契约 → typecheck（项目明确声明时）→ build → 浏览器预览
```

工作项：

- 定义版本化 Project/Verification Contract，并明确它在项目 provision、template upgrade 或显式 migration 时由哪个权威流程写入。
- Contract 明确声明允许执行的脚本、required checks、顺序和完成条件；`typecheck`、`build` 禁止从包名、依赖或历史消息猜命令。
- Contract 缺失或版本未知属于协议错误；显式空检查集合表示“不隐式运行 typecheck/build”，不等于任务自动完成。
- 编译、构建、运行时错误使用严格、有界的 ToolResult。
- Preview 绑定 AgentRun、ChangeSet、repository revision 和错误来源。
- 捕获受控 console 与延迟错误，并定义明确观察窗口。
- 验证失败回到当前 Run 的修复循环；达到预算后明确失败或阻塞。
- Verifier 输出结构化 Evidence；模型的文字结论不能覆盖验证结果。

验收：

- Agent 只有在 Verification Contract 声明的 required checks 和当前任务验收条件全部通过后才能进入成功终态。
- 用户手改错误只展示，不自动唤醒已经结束的 AgentRun。
- 延迟结果、旧 revision 和旧 attempt 不会污染当前验证状态。

### P5 —— ContextCheckpoint、分层压缩、Observability 与回滚

**目标**：长任务中控制上下文腐化，同时保留可恢复、可审计的事实。

压缩顺序：

1. 对工具结果设置预算；原文转为 Artifact，只保留预览和引用。
2. 删除确定无用的噪声。
3. 将已结束的旧历史压成 ContextCheckpoint。
4. 只有前三层仍不足时才执行完整 compaction，并有熔断和回退。

工作项：

- ContextCheckpoint 保留架构决定及原因、修改文件、验证状态、失败路径、待办、rollback 提示和结构化证据引用。
- 路径、revision、UUID、hash 只能来自权威记录，禁止让模型编造。
- 使用 versioned canonical serializer，确保数据库往返和进程重启后产生稳定表示。
- ContextCheckpoint 是低权限摘要；恢复后涉及代码事实时仍须重新读取 repository。
- 压缩阈值由 profile 和 eval 决定，不硬编码书中或其他项目的百分比。
- 基于 ChangeSet/RevisionCheckpoint 实现条件回滚，不覆盖任务结束后的用户修改；代码版本不得复用 ContextCheckpoint 的 schema 或生命周期。

验收：

- 长对话合法保持 tool pairing，旧源码不会被误当成当前代码。
- 同一 ContextCheckpoint 的 canonical 表示跨重启稳定。
- 压缩前后在固定任务上的成功率、成本和错误率可比较。

### P6 —— 执行环境与后台能力决策

**目标**：根据真实任务选择执行环境，不预设“持久 workspace 一定更好”。

能力边界：

| 代码存储 | 当前执行能力 | 多 Agent 限制 |
|---|---|---|
| Database | 服务端可读取和修改 | 可先支持服务端只读 Child 和单写者 |
| BrowserGit | 浏览器 Worker + IndexedDB | 页面离线时只能等待浏览器，不能声称后台继续 |

工作项：

- 分别测量 Database 与 BrowserGit 的读取、构建、预览、断线和恢复表现。
- 将“持久 Agent 调度器”和“持久代码 workspace”作为两个独立决策。
- 图片 worker 只作为异步任务生命周期的基础设施样本，不把它当作 Sub-agent。
- 只有 BrowserGit 后台访问或并行写入成为真实需求时，才设计远程物化、overlay 或隔离 worktree。
- 引入后端执行环境时，同批设计配额、超时、CPU/内存/进程限制、网络 allowlist、无生产密钥和独立产物 origin。

P6 不是只读 Sub-agent 的前置条件；它是 BrowserGit 后台 Child、headless verifier 和隔离写入型 Worker 的能力 Gate。

### P7 —— 条件性大型项目检索

**目标**：只补 eval 证明字面搜索解决不了的检索失败。

升级顺序：

1. 改善 `search_text` 的路径范围、结果分布和显式分页。
2. 只有大文件读取成为真实 token 瓶颈时，增加明确 range read。
3. import 依赖图与 TypeScript 符号索引。
4. 只有符号检索仍不能解决概念定位时，才考虑向量检索。

每一层都必须在相同任务集上证明增量收益。不得为了学习主题预设必须使用 LSP、tree-sitter、ts-morph、pgvector 或知识图谱。

### P8 —— Manager 与 Sub-agent

**目标**：让 Manager 在有明确收益时创建独立 Child AgentRun，并向用户展示可恢复的协作进度。

#### P8.1 唯一推荐拓扑

```text
Manager AgentRun
├── Explorer Child AgentRun（只读代码与资料）
├── Verifier Child AgentRun（获取独立外部证据）
└── Worker Child AgentRun（受控写入）
```

- Manager 是唯一面向用户协调、汇总和交付结果的 Agent，但不能越过 Verification Contract 的确定性完成 Gate。
- 每个 Child 使用独立 internal conversation、AgentRun、ContextAssembler 和 ContextCheckpoint。
- 父 Context 默认不复制给 Child；Child 完整轨迹也不复制回父 Context。
- Child 结果是待验证材料，不能自动升级为权威代码事实。

#### P8.2 谁决定是否 Spawn

Manager LLM 根据任务语义调用 `spawn_subagent` 工具，不额外增加一个分类 LLM。

Harness 只在以下条件全部满足时放行：

- 子任务边界和验收条件明确；
- 能引入新信息、隔离大量噪声、提供独立证据或真正并行；
- 已分配有限 token、step、时间和成本预算；
- 工具与执行域当前可用；
- 失败后可恢复或有替代路径；
- 满足只读、单写者或隔离工作副本之一。

以下情况拒绝 Spawn：

- 任务很小，委派成本高于直接执行；
- 需求仍有会改变实现方向的歧义；
- 只是让另一个模型阅读相同文本后进行无证据自评；
- 写集合重叠或无法划分；
- BrowserGit 页面离线但任务需要 repository；
- 任务包含未经用户授权的 commit、push 或其他外部副作用。

#### P8.3 通信与持久化

Manager → Child 的严格 ContextPacket 至少表达：

- 自包含目标和验收条件；
- 已确认约束及来源；
- repository identity、base revision 和必要 Artifact/Evidence 引用；
- 允许工具、权限、文件 ownership 和预算；
- 预期 Result schema。

Child → Manager 只返回结构化 Result：

- 结论；
- Evidence/Artifact 引用；
- 实际读写文件或 ChangeSet；
- 验证结果；
- unresolved issue 和 blocker。

Parent/Child identity、attempt、event sequence、幂等 spawn、terminal result 和 cancellation 必须持久化。迟到的旧 attempt result 只能记录诊断，不能进入父 Transcript。

#### P8.4 开放顺序

1. 冻结 Manager/Child、ContextPacket、Result、Artifact、Event 和 capability 契约。
2. 建立父子 AgentRun、任务依赖、预算、heartbeat、cancel 和 restore。
3. Database-only 只读 Explorer canary。
4. 有编译、preview、截图或工具证据的 Verifier。
5. 同一 repository 只有一个共享写入 Worker。
6. 依赖已满足且互不影响的只读任务并行执行。
7. 只有 eval 证明必要后，才实验 overlay/worktree 和集中 merge 的隔离写入。

#### P8.5 用户进度

- Active assistant bubble 显示可折叠的 Manager/Child 任务树。
- 每项显示角色、明确目标、权威状态、最后活动、工具、文件、Artifact 和验证结果。
- Child 需要输入时显示具体问题，由 task-specific action 回答。
- Stop 先显示“正在停止”，直到父子取消得到确认或 lease 失效。
- Database Child 可以标记“后台继续”；BrowserGit 必须明确“等待此浏览器工作区”。
- 刷新后从 restore snapshot 重建相同任务树。

验收：

- 重复 Spawn 不会创建第二个逻辑任务。
- Parent cancel 会级联 Child，旧 attempt 的迟到结果不会恢复父 Run。
- Child 失败不会自动让 Parent 假完成；Manager 可以替换、缩小或明确报告失败。
- 相比单 Agent，Sub-agent 在目标任务集上提供可测的新信息、上下文隔离或并行收益。

### P9 —— 条件性长期 Memory 与协议化

**目标**：只在跨会话重复需求达到可测规模后建设长期知识。

候选能力：

- 稳定用户偏好；
- 项目长期架构约束；
- “错误签名 → 已验证修法”的经验；
- 可追溯来源、冲突处理、过期、删除和隐私边界。

Memory 不得覆盖 Transcript、ContextCheckpoint、repository 或业务状态，也不能把一次失败尝试永久升级为经验。

内部工具只有在确实需要被外部 Agent 或第三方客户端复用时才 MCP 化；实时事件只有出现真实互操作需求时才对照 AG-UI 等协议重审。

## 6. 依赖顺序

```text
P-1 → P0 → P1 → P2 → P3 → P4 → P5
                         ├──→ P6
                         └──→ P7（由检索失败证据触发）

P5 → P8-A（Database Explorer/Verifier canary）
P8-A + P6 → P8-B（后台、BrowserGit 或隔离写能力）

P8-A + 跨会话重复需求证据 → P9
```

关键约束：

- P1 的 AgentRun/Stop/Restore 必须早于 P5 的压缩。
- P8 不依赖 P9；Memory 不是多 Agent 前置。
- P8 的只读 Explorer 不依赖持久 workspace。
- P9 必须晚于至少一轮 P8 Explorer/Verifier canary；不能因为出现跨会话需求就绕过多 Agent 主线提前建设 Memory。
- 写入型并行 Agent 必须等待 ChangeSet、durable receipt、Verifier 和隔离工作副本成熟。

## 7. 当前状态与下一步

| 状态 | 项目 |
|---|---|
| ✅ 已完成 | 首屏运行时错误反馈闭环 |
| ✅ 已完成 | 有界 `search_text` |
| ✅ 已完成 | 请求级 Stop：中止当前浏览器请求和 LLM stream |
| ✅ 已完成 | Database / BrowserGit `ProjectRepository` 双存储 |
| ✅ 已完成 | BrowserGit Source Control 与存储迁移 |
| ✅ 已完成 | 图片生成后台 worker |
| ⏭ 下一步 | P-1：Baseline + prompt/toolset/model Harness identity |
| ⏭ 随后 | P0：严格 Transcript + 行为等价 FullContextAssembler |
| ⏸ 暂缓 | 长期 Memory、自由消息总线、并行写入 Agent、向量检索、默认持久 workspace |

当前的请求级 Stop 已经解决“用户点击后继续调 LLM”的直接体验问题，但它不是最终的 durable cancellation。P1 仍需解决刷新、多实例、已启动工具、异步任务和迟到结果。

Roadmap 只管理阶段、依赖和验收 Gate。类型、schema、函数签名、逐文件 TODO 和手敲说明只维护在一份实施指南中，避免多个执行清单互相漂移。

## 8. 测试与 Eval 原则

- 只测试真实不变量：严格 schema、tool pairing、revision conflict、幂等、取消后不继续、恢复、来源归因和父子 Run fencing。
- UI 文案、简单展示、机械类型同步不新增仪式性测试。
- LLM eval 有随机性和调用成本，适合手动或定时运行，不作为每次本地修改的强制测试。
- Preview、Stop/Resume、客户端 mutation、异步工具和父子取消需要集成级验证，纯单元测试不足以证明闭环。
- 每次改变 prompt、工具描述、Context、压缩或 Spawn 策略，都要保留同一 fixture 的前后配对报告。
- 没有 baseline 前不拍脑袋制定压缩阈值、熔断次数、并发数或 Sub-agent 数量。

## 9. 明确暂不纳入

- 让多个 Agent 共享完整上下文并自由群聊。
- 没有外部证据的模型互评或自我辩论。
- 在共享 repository 上并行写入并依靠 last-write-wins。
- Redis 短期记忆；会话事实继续由 Transcript、AgentRun 和 ContextCheckpoint 管理。
- 默认向量数据库、知识图谱或通用消息队列。
- 模糊 patch、猜字段、猜 enum、猜命令或自动补业务结构。
- 为了“看起来像 Codex”而展示隐藏思维链；只展示结构化任务进度和证据。

## 10. 关联文档与权威关系

- 当前产品需求基线：[`REQUIREMENTS.md`](../REQUIREMENTS.md)。其中用于代码版本/回退的旧称 `checkpoint`，在本路线统一解释为 RevisionCheckpoint；大型项目与后台执行属于产品范围扩展，进入对应实现前仍需更新需求范围。
- Agent 演进参考：[`grok-build-agent-evolution.md`](./grok-build-agent-evolution.md)。它提供架构思路，不作为逐项实施清单；其中代码版本和上下文摘要必须按本路线拆成 RevisionCheckpoint 与 ContextCheckpoint。
- 多 Agent 目标设计：[`multi-agent-architecture.md`](./multi-agent-architecture.md)。它的 Manager 拓扑仍是参考，但其中“Postgres/`project_files` 是唯一代码权威”和旧里程碑顺序已经被双 `ProjectRepository` 基线与本 Roadmap supersede；实施前必须按 active repository 重审。
- BrowserGit 权威契约：[`browser-git-storage.md`](./browser-git-storage.md)。
- 异步图片任务：[`async-image-generation.md`](./async-image-generation.md)。
- 后端执行环境候选：[`backend-sandbox.md`](./backend-sandbox.md)。

阶段顺序和开放 Gate 以本 Roadmap 为准；storage 事实以 active `ProjectRepository` 与对应存储契约为准。当关联文档与当前代码事实不一致时，先更新契约和文档，不在实现中增加兼容性猜测。
