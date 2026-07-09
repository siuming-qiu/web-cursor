# Roadmap —— 大型项目支持路线

> Status: design note,非当前实现。
> 定稿:2026-07-09。
> 学习目标:手写实现 memory / retrieval / observability / eval / multi-agent / MCP 六大主题,不引入 LangChain 系框架(CLAUDE.md 铁律)。

## 1. 定位转向

本路线把产品目标从"小型 React 项目的生成沙箱"升级为"能在大型项目上工作的编码 agent"。这推翻了 REQUIREMENTS.md v0.2 的两条非目标(固定依赖、不服务完整工程),属于架构级转向。

**验收靶子(北极星升级)**:agent 能在一个 100+ 文件的真实模板项目(如 admin dashboard)上,完成一个跨 3-5 个文件的功能改动,并通过验证(typecheck + build + 预览)。

## 2. 现有架构的六处断裂点(已核实)

| # | 断裂点 | 位置 | 大型项目下的后果 |
|---|---|---|---|
| 1 | transcript 全量回放,零截断/总结 | `server/context.ts` | 长会话 + 大项目直接爆上下文窗口 |
| 2 | `write_file` 整文件覆盖,无 patch;无 grep/glob 工具 | `server/tools/definitions.ts` | 改一行付整个文件的 token;找代码只能 list + 整读 |
| 3 | WebContainer 每次 preview 全量 mount + `npm install`,且为单例 | `lib/webcontainer/runtime.ts:187-203` | 大依赖树在浏览器内又慢又脆;无并行执行能力 |
| 4 | `MAX_TOOL_ROUNDS = 16` | `app/api/chat/route.ts:34` | 大项目一次功能改动的读文件轮次即超限 |
| 5 | 文件真相源是 Postgres 行,无版本/diff/回滚 | `server/db/schema.ts` | agent 一次错误批量改写不可逆 |
| 6 | 唯一验证手段是全量跑起来 | `run_preview` 客户端工具 | 缺 typecheck/增量 build 的秒级反馈层 |

另有一处闭环缺陷属于路线第 0 步:浏览器运行时错误回传桥还没有完整接入 agent 自修闭环。

## 3. 目标架构

```
A. LLM 代理域         Next.js Route Handler,不变;agent loop 升级为服务端自治
B. 浏览器             降级为编辑器 + 预览查看器 + run 监控,不再是 agent 的手和眼
D. 持久化 workspace   每项目一个带 git 的真实文件系统(持久沙箱)
                      agent 全部工具在此执行:grep / edit / typecheck / build / preview
C. WebContainer       保留给小项目与 showcase 的即时预览(两档产品形态并存)
```

关键转变:

- `docs/backend-sandbox.md` 的一次性 build 验证升级为**持久 workspace**;git 仓库成为文件真相源,Postgres 退为元数据。
- agent run 成为一等公民:有生命周期(排队/运行/中断/完成),不再等于一条 SSE 连接的存活;断线重连可补回过程。
- 验证分层:typecheck(秒级)→ 增量 build → 定向预览,不再每轮全量 install。

## 4. 迭代路线

| 步 | 内容 | 为什么在这个位置 | 对应知识点 |
|---|---|---|---|
| 0 | **接通运行时错误桥**:注入上报脚本只是发送端;监听端现只更新 UI、不产出 ToolResult,且 `runPreview` 在 server-ready 即 resolve、turn 已闭合,运行时错误天然晚到。需定设计:server-ready 后错误收集窗口、晚到错误是否重开 turn、由客户端接通 `preview_feedback` 分支。**属新增能力,先走 OpenSpec 提案** | 闭环缺角,也是 eval 正确性的前提;不是一次小修 | — |
| 1 | **上下文工程**:token 预算、npm 日志错误摘要、旧轮次截断/总结 | 零新基建、当天见效;全量回放本质是隐性 bug | Memory 三大策略(截断/总结/检索) |
| 2 | **工具箱升级**:`edit_file`(old/new 片段替换)+ `grep` + `glob` | 不依赖新基建,现架构即可做;中型项目 token 消耗立降一个量级 | 工具设计(agent 能力 ≈ 工具质量) |
| 3 | **后端 workspace v1**:先按 backend-sandbox.md 做一次性 build 验证,但 schema 预留 run/workspace 生命周期;**限流配额同批上线** | 多 agent 与 headless eval 的地基;沙箱上线后滥用面从 LLM 额度升级为真实算力 | 沙箱隔离 / Docker(自托管备选) |
| 4 | **loop 服务端自治 + 手写 tracing + git 化 workspace**:run/span 落 Postgres + 简单 trace 查看页;版本回滚随 git 顺路解决 | run 生命周期与观测天然一体;image runner 残留的 poll lease 问题在此一并根治(独立 `poll_lease_until` 列) | LangSmith 全链路观测(手写版) |
| 5 | **eval harness**:固定 prompt 集 → 完整 agent loop → 沙箱验证 → 成功率 + 平均修复轮次;先小项目 baseline,再加大项目跨文件任务集 | 分水岭:它之前的步骤在还债,之后的步骤靠它出实验数据 | 量化评估 |
| 6 | **分层检索**:grep(精确)→ import 依赖图 + 符号索引(tree-sitter / ts-morph)→ pgvector 语义检索(兜底);修复经验库(错误签名 → 修法,跨会话长期记忆)同期 | 大项目下从 overkill 变真需求;有 eval 后每层收益可量化 | RAG / 混合检索 / Agentic RAG / Mem0 长期记忆 / 知识图谱(依赖图) |
| 7 | **多 agent**:大改动按模块拆 worker,各占 workspace 分支;reviewer 看 diff + typecheck 汇聚;subagent 上下文隔离 | 到这一步才有真实工作可分;依赖 1 的压缩与 3/4 的执行环境 | LangGraph / DeepAgents 概念(手写) |
| 8 | **协议与输出期**:工具 MCP 化(server 或 Figma client);SSE 事件协议对照 AG-UI spec 重审 | 重协议轻代码,适合收尾沉淀 | MCP / AGUI |

远期可选:Figma 设计图谱 ↔ 代码依赖图跨域映射("设计稿改了,哪些代码要重新生成"),唯一数据形状真正配得上图存储的场景,成本最高,砍小可先做单向 Figma 侧图谱强化 inspect。

## 5. 知识点取舍(明确不纳入本项目)

- 语音 ASR/TTS:与产品定位无关。
- Transformer 原理 / 训练推理:独立学习,与工程项目解耦。
- Nest:本项目是 Next 全栈,引第二后端框架是噪音。
- Milvus / ElasticSearch / Neo4j 作为基建:概念全部保留(向量检索、BM25 混合召回、图检索),实现一律用已有 Neon(pgvector + Postgres FTS)与内存邻接表。数据规模不配,为学而学不加基建。
- Redis 短期记忆:短期记忆就是 Postgres transcript,规模不需要。

## 6. 不能省的三个警告

1. **成本结构**:持久沙箱按小时计费;每 owner 配额与限流必须与 workspace 同批上线,不是后补项。
2. **安全面**:放开固定依赖后,`npm install` 任意包 = 供应链攻击面;backend-sandbox.md 安全清单里的网络 allowlist 从建议升级为必须。
3. **顺序纪律**:检索与多 agent(第 6/7 步)不得先于 eval(第 5 步)上线——没有数字证明的"更聪明"不算数。

## 7. 关联文档

- 后端沙箱选型:`docs/backend-sandbox.md`(本路线第 3 步的实现基线,persistence 部分需扩展)
- 需求基线:`REQUIREMENTS.md`(v0.2 的非目标两条被本路线推翻,需在下一版需求文档中正式改口)
