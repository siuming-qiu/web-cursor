# Web Cursor 可选 Browser Git 存储——需求与实现设计

> Status: Draft
>
> Scope: 为 Web Cursor 项目提供可选的浏览器 Git 存储；兼容现有数据库项目，并允许数据库项目后续迁移为 Git 项目。
>
> 核心依赖：`isomorphic-git`、浏览器持久文件系统、Web Worker、现有 WebContainer 预览链路、Postgres、Vercel Blob。
>
> 本文同时定义产品需求与推荐实现。标记为“待确认”的项目在编码前必须拍板；实现不得通过默认值猜测未知字段、状态或用户意图。

---

## 1. 背景

Web Cursor 当前采用以下代码存储拓扑：

```text
Postgres project_files      当前代码权威来源
        │
        ├── 服务端文件工具  list/search/read/write/delete/rename
        ├── Monaco Editor   通过文件 API 读写
        └── WebContainer    每次预览时挂载代码副本
```

该模式适合云端持久化和服务端 Agent 工具，但缺少真实 Git 仓库能力：

- 无 `.git` object database。
- 无 status、commit、branch、checkout、log。
- 无标准 Git remote/fetch/push 演进路径。
- 无法直接复用 Git 的历史、分支和合并模型。

浏览器已经具备持久文件系统能力，`isomorphic-git` 可以在浏览器中读写标准 Git 仓库。因此，本设计引入第二种项目存储后端：浏览器 Git。

问题的关键不是“运行 Git API”，而是保证任一项目在任一时刻只有一个可写代码来源。

---

## 2. 核心判断

### 2.1 值得实现

- Git 是真实用户能力，不是为了技术展示虚构的问题。
- Browser Git 符合 Web Cursor“浏览器内编码环境”的产品定位。
- `isomorphic-git` 避免自行实现 Git object、index、refs、packfile 和 remote protocol。
- 项目级存储模式允许渐进上线，不破坏现有数据库项目。

### 2.2 不采用的方案

#### 不把 `gitEnabled` 定义成普通布尔开关

启用 Git 会改变代码权威来源、文件工具执行位置和持久化协议。它不是随时开关的展示能力，而是项目存储后端迁移。

#### 不长期双写 `project_files` 和 Browser Git

双写会引入以下不可接受的问题：

- 两边写入部分成功。
- 不清楚 Editor、Agent 和 Preview 应读取哪一份。
- checkout/merge 后难以映射为数据库单文件更新。
- 刷新、跨设备和失败恢复时可能选择错误版本。

#### 不在第一版支持 Git → Database 降级

降级需要定义 branch、commit、未提交修改、Git history 丢失和 remote 解除语义。第一版只支持显式的 Database → Browser Git 单向迁移。

#### 不假设 WebContainer 自带原生 Git

WebContainer 继续只承担项目运行。Git 能力由 `isomorphic-git` 和 Browser Repository Worker 提供。

---

## 3. 目标与非目标

### 3.1 产品目标

1. 新建项目时，用户可以明确选择数据库存储或 Browser Git 存储。
2. 所有旧项目保持当前行为，不因上线 Git 功能发生隐式迁移。
3. 数据库项目可以在项目设置中安全地启用 Git。
4. Git 项目支持刷新恢复、文件编辑、Agent 修改和 WebContainer 预览。
5. Git 项目具备基础的 status、commit、log、branch 和安全 checkout 能力。
6. Git 项目清除本地浏览器数据后，可以从受控的云端 repository snapshot 恢复。
7. 任一项目始终只有一个可写代码来源。

### 3.2 技术目标

1. UI、Editor 和 Preview 依赖统一的 `ProjectRepository` 契约。
2. Database 项目继续使用服务端文件工具。
3. Browser Git 项目的文件工具改为浏览器客户端工具。
4. 所有 mutation 使用 revision/CAS，冲突必须暴露。
5. Migration 和 repository snapshot 具备幂等边界。
6. Preview result 绑定 workspace revision，过期结果不能触发 Agent 自修。

### 3.3 非目标

第一版不实现：

- GitHub/GitLab OAuth。
- clone/fetch/push。
- merge/rebase/reset --hard。
- force checkout/force push。
- 多人实时协作。
- 多设备自动合并未同步 working tree。
- Agent 每次修改后自动 commit。
- Git → Database 降级。
- 服务端解析或修改 Browser Git repository 内的单个源码文件。

---

## 4. 术语

| 术语 | 定义 |
|---|---|
| Database Project | `project_files` 是唯一代码来源的项目。 |
| Browser Git Project | 浏览器 Git working tree 是唯一代码来源的项目。 |
| Working Tree | Git 仓库中用户和 Agent 当前编辑的文件集合。 |
| Repository Worker | 唯一持有 Browser Git filesystem 和 `isomorphic-git` 实例的 Web Worker。 |
| Workspace Revision | 每次成功 working tree mutation 后单调递增的本地一致性版本。 |
| Project Code Revision | Database 项目每次成功文件 mutation 后单调递增的服务端版本。 |
| Repository Snapshot | 包含 working tree 与 `.git` 的不可变、版本化仓库归档。 |
| Snapshot Generation | 云端 repository snapshot 的 CAS 版本。 |
| Migration Attempt | 一次 Database → Browser Git 转换流程的持久化记录。 |
| Legacy Files | Git 激活后保留但不再进入正常读写链路的旧 `project_files`。 |

---

## 5. 产品决策

### 5.1 已推荐采用

- 项目存储类型使用明确枚举，不使用 boolean。
- 旧项目全部显式回填为 Database 模式。
- 新建项目请求必须显式携带存储类型。
- Browser Git 使用 `isomorphic-git`。
- 浏览器 filesystem 第一版使用 LightningFS/IndexedDB。
- Git filesystem 和 mutation 只由 Repository Worker 持有。
- Git 模式激活前必须存在可恢复的私有 Blob repository snapshot。
- Git 项目的 WebContainer 是只运行、不回写的镜像。
- Git 项目的服务端数据库文件接口必须明确拒绝访问。
- Migration initial commit 的 author 必须来自明确用户输入。
- Browser Git 第一版不自动 commit Agent 修改。

### 5.2 待确认

编码前必须确认：

1. 新建项目 UI 默认选择 Database 还是 Browser Git。
2. Git author 是否按项目保存，还是按 owner 保存并允许项目覆盖。
3. Repository snapshot 最大压缩前/压缩后体积。
4. 旧 `project_files` 在 Git 激活后的保留周期。
5. Migration attempt 的超时时间。
6. Browser Git 是否第一版就支持 branch，还是先只支持 main + commit/log。
7. 跨标签页是否第一版采用单写 lease，或直接禁止同时打开同一 Git 项目。

任何待确认项目都不得通过代码中的“合理默认值”静默决定。

---

## 6. 用户需求

### R-GIT-1：新建项目选择存储模式

作为用户，我可以在新建项目时明确选择：

- Database：保持当前云端文件存储体验。
- Browser Git：使用浏览器 Git repository 管理代码。

验收标准：

- 创建请求明确包含 storage kind。
- 未知 storage kind 返回 400。
- 请求缺少必填 storage kind 返回 400。
- Git provisioning 完成前不能开始 Agent 写文件。
- Git provisioning 失败时显示重试或删除，不伪装成成功项目。

### R-GIT-2：旧项目保持兼容

作为现有用户，我升级 Web Cursor 后，旧项目仍能正常打开、编辑、对话和预览。

验收标准：

- 旧项目全部显式标记为 Database 模式。
- 旧项目文件仍来自 `project_files`。
- 不自动创建 Git repository。
- 不改变旧项目的历史会话和 Preview 行为。
- 不使用 `storageKind ?? database` 兜底。

### R-GIT-3：数据库项目后续启用 Git

作为用户，我可以在 Database 项目设置中点击“启用 Git”，将当前项目完整迁移为 Browser Git 项目。

验收标准：

- 有未保存 draft 时不能开始迁移。
- 有活动写入时不能开始迁移。
- Migration 期间普通文件 mutation 被拒绝。
- 全部路径和内容必须无损进入 Git working tree。
- Migration 创建明确 initial import commit。
- 激活前必须校验路径集合、内容 hash、clean status 和 HEAD。
- 任一步失败时项目继续保持 Database 模式。
- 激活成功后数据库文件接口不再读写该项目。

### R-GIT-4：Git working tree 编辑

作为 Git 项目用户，我可以继续使用 Monaco 文件树和编辑器读写项目。

验收标准：

- Monaco 内容是明确 draft。
- 保存后才写 working tree。
- File tree 从 Browser Repository 派生。
- 新建、重命名、删除均经过同一个 Repository Worker。
- mutation 冲突返回可诊断错误。
- `.git/**` 不能通过普通项目文件 API 修改。

### R-GIT-5：Agent 修改 Git 项目

作为 Git 项目用户，我可以继续通过自然语言让 Agent 读取和修改代码。

验收标准：

- LLM 看到的工具名称和参数契约保持一致。
- Database 项目文件工具在服务端执行。
- Browser Git 项目文件工具在浏览器执行。
- 每个 client tool call 恰好有一个闭合结果。
- 相同 toolCallId 不会重复 mutation。
- stop 后不能开始新的 mutation。
- stale workspace revision 不得覆盖新内容。

### R-GIT-6：Git 状态与提交

作为 Git 项目用户，我可以查看修改并创建 commit。

验收标准：

- 显示新增、修改、删除、重命名状态。
- 可以查看文件 diff。
- 可以 stage/unstage。
- commit message 必填。
- Git author 缺失时停止并要求配置。
- 没有 staged changes 时不能伪装提交成功。
- commit 成功后 status、log 和云同步状态刷新。

### R-GIT-7：分支与 checkout

作为 Git 项目用户，我可以创建和切换分支。

验收标准：

- 可以查看当前分支和分支列表。
- 可以创建分支。
- working tree dirty 时第一版拒绝 checkout。
- Monaco 有未保存 draft 时拒绝 checkout。
- checkout 后文件树、Editor 和 Preview 同时切换。
- 不提供 force checkout。

### R-GIT-8：刷新与恢复

作为 Git 项目用户，我刷新页面后可以继续使用当前仓库；本地仓库缺失时可以从云端 snapshot 恢复。

验收标准：

- 正常刷新优先打开本地仓库。
- 本地仓库缺失时下载明确 generation 的 snapshot。
- 解包前校验 archive version 和路径安全。
- 解包后校验 HEAD、workspace hash 和文件集合。
- 本地与服务端 generation 分叉时显示冲突，不按时间戳猜最新。
- 不从 legacy `project_files` 静默恢复。

### R-GIT-9：WebContainer 预览

作为 Git 项目用户，我可以像 Database 项目一样运行预览并让 Agent读取真实错误。

验收标准：

- Preview 文件来自当前 ProjectRepository。
- `.git/**` 不进入 WebContainer。
- `node_modules`、构建产物和运行时文件不回写 repository。
- Preview result 携带 workspace revision。
- workspace revision 已变化时，旧 Preview result 只能展示，不能唤醒 Agent 自修。

### R-GIT-10：项目删除

作为用户，我删除 Git 项目后，项目元数据、repository snapshot 和浏览器仓库应按明确规则清理。

验收标准：

- 项目先完成服务端软删。
- 本地仓库清理失败不伪装服务端删除失败。
- Blob 清理失败进入可重试清理记录。
- Migration candidate 和 legacy files 有独立清理策略。

---

## 7. 非功能需求

### 7.1 一致性

- 任一项目在任一时刻只有一个可写代码来源。
- 所有 mutation 必须有 expected revision。
- revision 不一致必须失败。
- 不允许 last-write-wins。
- Migration 激活必须是服务端原子状态切换。
- Snapshot 上传成功不等于项目已切换 Git。

### 7.2 安全

- Browser Git 代码仍是不可信代码。
- `.git` 不进入预览 iframe。
- 服务端不执行项目代码。
- Archive 解包必须阻止绝对路径和 `..` 路径穿越。
- Snapshot Blob 使用 private access。
- Client tool result 必须匹配 transcript 中未闭合的 tool call。
- Git remote token 将来只能在服务端保存。

### 7.3 可诊断性

- Migration 每一阶段都有明确状态和错误。
- 不支持的 snapshot version 明确报错。
- Repository missing、repository corrupt、generation conflict 必须区分。
- Blob orphan、expired migration 和本地 candidate 清理失败必须可追踪。

### 7.4 性能

- Git 和 filesystem 重操作在 Web Worker 执行。
- Project source 不重复保存在 React state。
- Preview 只导出需要运行的项目文件。
- Snapshot 上传应 debounce，但不能吞掉 unsynced 状态。
- 大仓库限制必须由权威配置定义。

### 7.5 向后兼容

- Database 项目在 Repository 抽象接入后行为不变。
- 旧项目 schema backfill 是显式数据迁移。
- Git 功能未激活时不影响现有 Agent loop。
- 现有会话、消息、附件和项目资产继续挂 project/conversation。

---

## 8. 目标架构

### 8.1 Database 项目

```text
Postgres project_files       唯一可写代码源
        │
        ├── DatabaseProjectRepository
        ├── 服务端 Agent 文件工具
        ├── Monaco draft → save API
        └── exportPreviewFiles → WebContainer
```

### 8.2 Browser Git 项目

```text
LightningFS / IndexedDB
└── Git working tree         唯一可写代码源
    ├── .git/
    └── project files
          │
          ├── BrowserGitProjectRepository
          ├── Repository Worker
          ├── Monaco draft → Worker save
          ├── Agent client tools
          ├── isomorphic-git
          └── exportPreviewFiles → WebContainer

Private Blob repository snapshot
└── 只作为版本化持久副本，不提供单文件写入
```

### 8.3 状态 owner

| 事实 | Owner |
|---|---|
| Project storage kind | Postgres projects |
| Database project source | Postgres project_files |
| Git working tree/source | Repository Worker filesystem |
| Monaco 未保存内容 | Editor draft state |
| Git status/log/branch | Repository Worker 派生结果 |
| Preview runtime | usePreview/WebContainer |
| Repository cloud generation | Postgres repository binding |
| Repository archive bytes | Private Blob |
| Conversation/Agent transcript | Postgres messages |

---

## 9. 存储模式与迁移状态机

### 9.1 Storage kind

推荐契约：

```ts
export const ProjectStorageKind = {
  Database: "database_v1",
  BrowserGit: "browser_git_v1",
} as const;
```

未知值必须报错，禁止 normalize 到任意已知类型。

### 9.2 Migration 状态

推荐状态机：

```text
PREPARING
   │ candidate 创建并校验
   ▼
SNAPSHOT_READY
   │ 服务端原子 activate
   ▼
ACTIVATED

PREPARING/SNAPSHOT_READY
   ├── FAILED
   ├── CANCELLED
   └── EXPIRED
```

状态转换必须通过显式 action 完成。未知 action 或非法转换返回 400/409，不自动跳转。

### 9.3 新建 Git 项目

新建 Browser Git 项目同样走 provisioning/migration 机制：

1. 服务端创建项目元数据。
2. 项目暂时不可进入 Agent 写入状态。
3. 服务端创建目标为 Browser Git 的 migration attempt。
4. 浏览器初始化空 repository。
5. 浏览器生成并上传初始 snapshot。
6. 服务端激活 Browser Git storage。
7. 项目进入 ready，之后才能发送第一条聊天。

如果 provisioning 失败，项目保持明确的 setup failure 状态，UI 提供 retry/delete；不得默认为 Database 项目继续执行。

---

## 10. 数据契约设计

> 本节定义所需事实，不代表已经确认最终 SQL 字段名。P1 实施前必须将其冻结为权威 schema。

### 10.1 projects 增量事实

必须能够表达：

- storage kind。
- Database code revision。
- 当前项目是否可开始文件 mutation。
- Browser Git 项目当前 repository binding。
- 项目更新时间和软删状态。

约束：

- Database 项目不能有可写 Browser Git binding。
- Browser Git 项目必须有 ready repository snapshot/binding。
- Browser Git 项目不能进入数据库文件工具。
- 空/未知 storage kind 不合法。

### 10.2 project_storage_migrations

必须能够表达：

- migration id。
- project id。
- source storage kind。
- target storage kind。
- source project revision。
- migration status。
- candidate workspace hash。
- candidate HEAD OID；空仓库允许 null。
- ready snapshot id/generation。
- 创建、更新时间和过期时间。
- 明确失败码和有界错误摘要。

约束：

- 同一项目最多一个 active migration。
- source/target 必须是已定义 storage kind。
- 第一版只允许 Database → Browser Git。
- ACTIVATE 必须从 SNAPSHOT_READY 转换。

### 10.3 project_repository_snapshots

必须能够表达：

- snapshot id。
- project id。
- generation。
- archive format version。
- private blob path。
- byte size。
- workspace hash。
- HEAD OID；unborn repo 允许 null。
- 创建时间和软删时间。

约束：

- project + generation 唯一。
- generation 只能通过 CAS 增长。
- Blob 上传完成且校验通过后才能插入 ready snapshot metadata。

### 10.4 repository binding

必须能够表达：

- Browser Git 项目的 active snapshot。
- 当前 generation。
- 上次同步时间。
- 当前 HEAD OID。

服务端不通过该 binding 读取或修改单个源码文件；它只负责 repository archive 的持久版本协调。

### 10.5 ProjectDetail 响应

使用严格 discriminated union：

```ts
type DatabaseProjectDetail = {
  storageKind: "database_v1";
  codeRevision: number;
  files: ProjectFileSummary[];
  // common project/conversation fields
};

type BrowserGitProjectDetail = {
  storageKind: "browser_git_v1";
  repository: {
    generation: number;
    headOid: string | null;
    snapshotId: string;
  };
  // common project/conversation fields
};
```

Browser Git 响应不返回数据库 `files` 空数组，因为空数组会伪装成“Git 项目没有文件”。

---

## 11. API 契约

所有内部 Route Handler 继续只使用 GET/POST。

### 11.1 POST /api/projects

职责：创建明确存储类型的项目。

请求必须包含：

```json
{
  "title": "untitled",
  "storageKind": "database_v1"
}
```

或：

```json
{
  "title": "untitled",
  "storageKind": "browser_git_v1"
}
```

响应必须区分：

- Database ready project。
- Browser Git provisioning project + migration id。

不得从缺失字段猜测 storage kind。

### 11.2 GET /api/projects/:id

职责：返回严格的 Database/Git ProjectDetail union。

- Database 才读取 `listProjectFiles()`。
- Browser Git 返回 repository descriptor。
- provisioning/migration failure 返回明确状态。

### 11.3 POST /api/projects/:id/storage

职责：管理显式 storage migration action。

建议 action：

- `prepare_browser_git`
- `activate_browser_git`
- `cancel_migration`
- `retry_migration`

每个 action 使用严格 discriminated Zod schema。非法状态转换返回 409。

### 11.4 GET/POST /api/projects/:id/repository-snapshots

GET：

- 获取 active snapshot descriptor。
- 下载指定 generation 的私有 archive。

POST：

- 上传/登记一个新 snapshot generation。
- 必须携带 expected generation。
- body size 超限明确拒绝。
- Blob put 成功但 DB 失败时记录 orphan cleanup。

### 11.5 Database 文件 API

所有文件接口必须：

- 查询并验证项目 storage kind。
- 仅允许 Database 项目。
- mutation 携带 expected code revision。
- revision mismatch 返回 409。
- active migration 时拒绝 mutation。
- Browser Git 项目返回明确 storage mismatch，不能返回空结果。

### 11.6 POST /api/chat

推荐取消“首条聊天隐式创建未知存储项目”的行为：

1. 首页先创建项目。
2. Browser Git 项目先完成 provisioning。
3. 第一条聊天携带已存在 projectId。
4. conversation 仍可在 `/api/chat` 内懒建。

### 11.7 POST /api/conversations/:id/tool-results

客户端文件工具接入前必须加固：

- toolCallId 必须对应 transcript 尾部未闭合调用。
- result 必须匹配原工具名称和具体 schema。
- Browser Git storage 才允许客户端文件工具结果。
- 同一个 toolCallId 只能闭合一次。
- 重复、晚到和跨项目 result 必须明确拒绝或返回已闭合结果。

---

## 12. ProjectRepository 抽象

### 12.1 目标

Editor、Workbench、Preview 不应散落 `if (gitEnabled)`。它们只依赖一个稳定接口。

推荐契约：

```ts
interface ProjectRepository {
  readonly projectId: string;
  readonly storageKind: ProjectStorageKind;

  getRevision(): Promise<number>;
  listFiles(): Promise<ProjectFileSummary[]>;
  readFile(path: string): Promise<ProjectFileContent>;
  searchText(query: string): Promise<ProjectTextSearchResult>;

  writeFile(input: WriteFileInput): Promise<WorkspaceChange>;
  deleteFile(input: DeleteFileInput): Promise<WorkspaceChange>;
  renameFile(input: RenameFileInput): Promise<WorkspaceChange>;

  exportPreviewFiles(): Promise<PreviewWorkspaceSnapshot>;
}
```

### 12.2 DatabaseProjectRepository

- 封装现有 project file REST API。
- 使用 project code revision。
- 保持当前文件保存语义。
- 不提供 Git-only 操作。

### 12.3 BrowserGitProjectRepository

- 通过 Worker client 调用 Repository Worker。
- 主线程不直接持有 filesystem。
- 使用 workspace revision。
- 提供额外 Git capability：status/add/resetIndex/commit/log/branches/checkout。

### 12.4 Repository factory

必须 exhaustive dispatch：

```ts
switch (project.storageKind) {
  case ProjectStorageKind.Database:
    return createDatabaseProjectRepository(project);
  case ProjectStorageKind.BrowserGit:
    return createBrowserGitProjectRepository(project);
  default:
    return assertNever(project);
}
```

禁止 unknown → Database fallback。

---

## 13. Browser Repository Worker

### 13.1 Owner 规则

- Worker 是 filesystem 和 `isomorphic-git` 的唯一 owner。
- 每个 projectId 使用独立 namespace。
- migration candidate 使用 migrationId 临时 namespace。
- 所有 mutation 进入串行 command queue。
- 每次成功 mutation 单调递增 workspace revision。
- Git/filesystem mutation 后执行明确 flush。
- Worker crash 返回 repository unavailable，不自动重建仓库。

### 13.2 普通文件命令

- list files。
- search text。
- read file。
- write file。
- delete file。
- rename file。
- export preview files。

所有 mutation 携带 expected workspace revision。

### 13.3 Git 命令

第一版：

- init。
- status matrix。
- add。
- unstage/reset index（只影响 index，不执行 hard reset）。
- commit。
- log。
- current branch。
- list branches。
- create branch。
- checkout clean working tree。

不支持的命令不得暴露半成品 UI。

### 13.4 路径规则

- 拒绝绝对路径。
- 拒绝空路径。
- 拒绝 `.`、`..` 路径段。
- 拒绝重复分隔符。
- 普通文件 API 拒绝 `.git` 和 `.git/**`。
- Archive 内允许 `.git/**`，但只由 snapshot serializer/restore 操作。
- 不自动重命名非法路径。

---

## 14. Agent 客户端工具实现

### 14.1 执行位置选择

LLM 工具定义保持不变：

- list_files
- search_text
- read_file
- write_file
- delete_file
- rename_file
- run_preview

执行位置由项目 storage kind 决定：

| 工具 | Database | Browser Git |
|---|---|---|
| list/search/read | 服务端 | 浏览器 Repository Worker |
| write/delete/rename | 服务端 | 浏览器 Repository Worker |
| run_preview | 浏览器 | 浏览器 |

### 14.2 Client tool loop

```text
LLM tool_call
   │
   ├── Database tool → server executor → append tool result → loop continues
   │
   └── Browser Git file tool
          ↓
      SSE client_tool_call
          ↓
      Repository Worker execute
          ↓
      POST tool result
          ↓
      transcript closes tool call
          ↓
      POST /api/chat kind=resume
```

### 14.3 一致性要求

- Client mutation 参数必须携带 expected workspace revision。
- 相同 toolCallId 重放不得重复 mutation。
- Tool result 记录实际 revision 和精确 change。
- 失败 result 也要闭合 tool call。
- stop/abort 后不得开始下一个 mutation。
- Agent 遇到 conflict 必须重新读取，不能自动覆盖。

---

## 15. Database → Browser Git 迁移实现

### 15.1 Preflight

1. 用户打开“启用 Git”对话框。
2. UI 展示该操作第一版不可逆。
3. 用户填写 Git author name/email。
4. 检查 Monaco 未保存 draft。
5. 检查文件同步状态。
6. 检查活动 Agent 写入。
7. 服务端获取 migration lease。
8. 服务端冻结 source project revision。

任一前提不满足时停止，不自动保存/取消/覆盖。

### 15.2 Prepare

服务端：

1. 验证 owner/project。
2. 验证 storage kind 为 Database。
3. 验证无 active migration。
4. 创建 PREPARING migration。
5. 返回 migrationId、source revision 和完整 live file snapshot。

如果项目含 `.git` 或 `.git/**`，返回明确冲突。

### 15.3 Candidate repository

浏览器：

1. 创建 migration candidate namespace。
2. `git.init()`。
3. 原样写入全部文件。
4. `git.add()` 全部项目文件。
5. 使用用户提供的 author 创建 initial import commit。
6. 检查 working tree clean。
7. 比较源/目标路径集合。
8. 比较每个文件 content hash。
9. 获取并记录 HEAD OID。
10. 生成 versioned repository snapshot。

### 15.4 Snapshot upload

1. 上传 private Blob。
2. 服务端验证 archive metadata、大小和 migration ownership。
3. 插入 snapshot metadata。
4. 将 migration 从 PREPARING 转为 SNAPSHOT_READY。

Blob 上传成功但 DB 失败时，Blob 是 orphan，必须进入清理队列；不得切换项目。

### 15.5 Activate

服务端事务：

1. 锁定 project/migration。
2. 验证项目仍是 Database。
3. 验证 source revision 未变化。
4. 验证 migration 为 SNAPSHOT_READY。
5. 验证 snapshot project/migration/generation/hash/HEAD。
6. 建立 repository binding。
7. 切换项目为 Browser Git。
8. 标记 migration ACTIVATED。

只有事务全部成功，权威来源才切换。

### 15.6 Finalize

客户端：

1. 将 candidate namespace 提升为正式 project namespace，或从 ready snapshot 重建正式 namespace。
2. 创建 BrowserGitProjectRepository。
3. 加载文件树。
4. 运行预览。
5. 展示 initial import commit 和 synced 状态。

如果服务端已 activate 但本地 finalize 失败，必须从 ready Blob snapshot 重建；禁止读取 legacy files。

### 15.7 失败语义

| 失败点 | 结果 |
|---|---|
| Prepare 前 | 项目不变。 |
| Candidate 创建/校验失败 | 删除 candidate；项目保持 Database。 |
| Snapshot 上传失败 | 项目保持 Database。 |
| Source revision 变化 | Activate 返回 conflict；删除 candidate 后重试。 |
| Activate 事务失败 | 项目保持 Database。 |
| Activate 后本地缺失 | 从 active repository snapshot 恢复。 |

任何失败都不允许同时继续写两套存储。

---

## 16. Repository Snapshot 格式

### 16.1 内容

Snapshot 包含：

- `.git/**`。
- working tree 项目文件。
- versioned manifest。

Snapshot 排除：

- `node_modules/**`。
- build output。
- WebContainer runtime 注入文件。
- 临时日志和进程文件。

### 16.2 Manifest 必须包含

- format version。
- project id。
- workspace revision。
- snapshot generation。
- HEAD OID 或明确 null。
- current branch 或明确 unborn 状态。
- workspace hash。
- 文件路径和内容 hash 清单。

### 16.3 Restore 校验

- format version 必须已知。
- project id 必须匹配。
- 禁止绝对路径。
- 禁止路径穿越。
- 禁止重复路径。
- 解包后 HEAD 必须与 manifest 一致。
- working tree hash 必须一致。
- 校验失败时保留原本地仓库，不覆盖。

### 16.4 Generation/CAS

上传新 snapshot 必须携带 base generation：

```text
local base generation = server active generation
        │ yes
        ▼
upload generation + 1

        │ no
        ▼
409 generation conflict
```

冲突后禁止按 `updatedAt` 自动选择版本。

---

## 17. Editor 与 Preview 实现

### 17.1 Editor draft

```text
Monaco draft
    │ explicit save
    ▼
ProjectRepository.writeFile(expectedRevision)
    │
    ▼
唯一代码源
```

- Draft 是临时状态，不是第二个持久源码。
- 发送 Agent 请求前必须先处理 draft。
- checkout、migration、restore 前必须处理 draft。
- 不使用 useEffect 观察 draft 后自动同步 repository。

### 17.2 Preview snapshot

`exportPreviewFiles()` 返回：

- project files。
- 对应 project/workspace revision。
- 不包含 `.git`。

WebContainer：

- mount snapshot。
- npm install。
- npm run dev。
- 返回携带 revision 的结果。
- 不把运行环境文件同步回 repository。

### 17.3 Stale result

如果 Preview 完成时当前 revision 已经变化：

- UI 可以展示结果已经过期。
- 不自动触发 Agent 修复。
- 不把错误归因给新 revision。

---

## 18. Git UI

### 18.1 项目存储设置

Database 项目显示：

- 当前模式：Database。
- “启用 Git”入口。
- 迁移说明和不可逆提示。

Browser Git 项目显示：

- 当前模式：Browser Git。
- 本地/云端同步状态。
- snapshot generation。
- 不显示简单“关闭 Git”开关。

### 18.2 Git Panel

第一版建议显示：

- current branch。
- HEAD short OID。
- staged changes。
- unstaged changes。
- commit message composer。
- commit history。
- branch list/create/checkout（若产品决策纳入第一版）。

### 18.3 Diff

- 文件列表只展示真实 status。
- 选中文件使用 Monaco Diff Editor。
- 新增文件与空 base 比较。
- 删除文件与空 target 比较。
- Binary/不可解码文件明确显示不支持文本 diff，不猜编码。

---

## 19. 旧数据策略

Git 激活后：

- 旧 `project_files` 暂时保留为 legacy backup。
- 正常业务 API 和 Agent 禁止读取。
- Repository 丢失时禁止静默回退。
- 管理员恢复工具必须明确显示 legacy revision 和潜在数据丢失。
- 保留周期结束后，由独立清理任务删除。

保留旧数据不等于双写；它不可写、不可进入正常读取链路，只是迁移前备份。

---

## 20. 文件变更树

```text
/Users/siuming/learning/web-cursor
├── UPDATE package.json
│
├── types
│   ├── NEW    projectStorage.ts
│   ├── NEW    repository.ts
│   ├── UPDATE chat.ts
│   ├── UPDATE tool.ts
│   └── UPDATE toolSchema.ts
│
├── lib
│   ├── UPDATE projectTypes.ts
│   ├── NEW    repository
│   │   ├── contract.ts
│   │   ├── createProjectRepository.ts
│   │   ├── databaseRepository.ts
│   │   ├── browserGitRepository.ts
│   │   ├── browserGitWorkerClient.ts
│   │   ├── archive.ts
│   │   └── errors.ts
│   └── UPDATE webcontainer
│       ├── runtime.ts
│       └── types.ts
│
├── workers
│   └── NEW    browserGitRepository.worker.ts
│
├── server
│   ├── db
│   │   └── UPDATE schema.ts
│   ├── NEW    projectStorage.ts
│   ├── NEW    projectStorageMigrations.ts
│   ├── NEW    repositorySnapshots.ts
│   ├── UPDATE files.ts
│   ├── UPDATE toolCalls.ts
│   └── tools
│       └── UPDATE executor.ts
│
├── app/api
│   ├── UPDATE chat/route.ts
│   ├── UPDATE projects/route.ts
│   ├── UPDATE projects/[id]/route.ts
│   ├── UPDATE projects/[id]/files/route.ts
│   ├── UPDATE projects/[id]/files/content/route.ts
│   ├── UPDATE projects/[id]/files/rename/route.ts
│   ├── NEW    projects/[id]/storage/route.ts
│   ├── NEW    projects/[id]/repository-snapshots/route.ts
│   └── UPDATE conversations/[id]/tool-results/route.ts
│
├── hooks
│   ├── NEW    useProjectRepository.ts
│   ├── NEW    useGitWorkspace.ts
│   ├── UPDATE useProjectFiles.ts
│   ├── UPDATE useProjectSession.ts
│   ├── UPDATE useWorkbenchController.ts
│   ├── UPDATE useChat.ts
│   └── UPDATE usePreview.ts
│
├── components
│   ├── project
│   │   ├── UPDATE HomePage.tsx
│   │   └── UPDATE ProjectHome.tsx
│   └── workbench
│       ├── UPDATE WorkbenchTopBar.tsx
│       ├── NEW    ProjectStorageDialog.tsx
│       ├── NEW    EnableGitDialog.tsx
│       ├── NEW    GitPanel.tsx
│       ├── NEW    GitCommitDialog.tsx
│       └── NEW    GitMigrationProgress.tsx
│
├── UPDATE components/Workbench.tsx
├── UPDATE messages/zh.json
├── UPDATE messages/en.json
├── UPDATE README.md
└── UPDATE README.zh-CN.md
```

---

## 21. 分阶段实施 TODO

### Phase 0：冻结契约

- [ ] 拍板第 5.2 节全部待确认项。
- [ ] 冻结 storage kind 常量。
- [ ] 冻结 migration status/action 常量。
- [ ] 冻结 repository snapshot manifest。
- [ ] 冻结 Database/Git ProjectDetail union。
- [ ] 冻结错误码和 HTTP status 映射。

### Phase 1：Schema、revision 与 guard

- [ ] 更新 Drizzle schema。
- [ ] 旧项目显式回填 Database storage kind。
- [ ] 增加 project code revision。
- [ ] 增加 migration/snapshot/binding schema。
- [ ] Database 文件 mutation 接入 expected revision。
- [ ] active migration 拒绝文件 mutation。
- [ ] Browser Git 项目拒绝数据库文件 API。
- [ ] 运行 schema migration 和现有 build/typecheck。

### Phase 2：ProjectRepository 抽象

- [ ] 定义 ProjectRepository contract。
- [ ] 实现 DatabaseProjectRepository。
- [ ] 让 `useProjectFiles` 依赖 repository，而不是直接 fetch。
- [ ] 改造 project detail 为 discriminated union。
- [ ] 验证所有 Database 项目行为不变。

### Phase 3：Browser Repository Worker

- [ ] 添加并锁定 `isomorphic-git`/filesystem 依赖。
- [ ] 实现 Worker command protocol。
- [ ] 实现串行 mutation queue。
- [ ] 实现 workspace revision/CAS。
- [ ] 实现普通文件命令。
- [ ] 实现 Git MVP 命令。
- [ ] 实现 flush 和错误分类。

### Phase 4：Repository snapshot

- [ ] 选择并锁定 archive 实现。
- [ ] 实现 versioned manifest。
- [ ] 实现 archive serialize/restore。
- [ ] 实现路径安全和 hash 校验。
- [ ] 实现 private Blob upload/download。
- [ ] 实现 generation CAS。
- [ ] 实现 orphan cleanup 记录。

### Phase 5：新项目 provisioning

- [ ] 新建项目 UI 增加存储选择。
- [ ] 创建 API 要求 storage kind。
- [ ] 首页先创建项目，再发送聊天。
- [ ] Browser Git 项目创建 provisioning migration。
- [ ] 初始化空 repository/snapshot。
- [ ] 激活后才允许第一条聊天。
- [ ] 失败提供 retry/delete。

### Phase 6：旧项目启用 Git

- [ ] 实现 EnableGitDialog。
- [ ] 实现 author 配置。
- [ ] 实现 preflight/lease。
- [ ] 实现 prepare/candidate/validate/upload/activate/finalize。
- [ ] 实现迁移进度 UI。
- [ ] 实现失败清理和重试。
- [ ] 保留但隔离 legacy files。

### Phase 7：Agent client file tools

- [ ] 按 storage kind 选择工具执行位置。
- [ ] 扩展 client tool call SSE 协议。
- [ ] Browser Git 文件工具接入 Repository Worker。
- [ ] 加固 tool-results pairing/idempotency。
- [ ] mutation result 携带 revision/change。
- [ ] stop 后禁止新 mutation。

### Phase 8：Editor/Preview 集成

- [ ] BrowserGitProjectRepository 接入 Editor。
- [ ] 明确 draft/save 边界。
- [ ] Preview 使用 repository snapshot。
- [ ] 排除 `.git`。
- [ ] Preview result 绑定 revision。
- [ ] stale result 不触发自修。

### Phase 9：Git UI

- [ ] Git status panel。
- [ ] stage/unstage。
- [ ] Monaco diff。
- [ ] commit dialog。
- [ ] commit log。
- [ ] branch/create/checkout（取决于产品决策）。
- [ ] synced/unsynced/conflict 状态。

### Phase 10：清理与文档

- [ ] 定义 legacy files 清理周期。
- [ ] 实现 expired migration cleanup。
- [ ] 实现 orphan Blob cleanup。
- [ ] 更新 README 当前能力和限制。
- [ ] 更新 roadmap。
- [ ] 记录 remote Git 后续方案。

### Phase 11：Git remote（后续）

- [ ] 设计同源 Git HTTP proxy。
- [ ] GitHub OAuth/token 服务端存储。
- [ ] public/private clone。
- [ ] fetch/push。
- [ ] non-fast-forward 明确失败。
- [ ] 禁止自动 force push/merge。

---

## 22. 测试与验证策略

只新增具有真实防回归价值的测试。

### 22.1 必须自动化验证的核心不变量

#### Storage/schema

- [ ] 旧项目全部成为明确 Database 模式。
- [ ] null/未知 storage kind 被拒绝。
- [ ] Git 项目不能通过数据库文件 API 读写。
- [ ] stale project revision mutation 返回 conflict。
- [ ] active migration 时普通 mutation 被拒绝。

#### Repository Worker

- [ ] mutation 串行且 revision 单调递增。
- [ ] stale workspace revision 被拒绝。
- [ ] `.git/**` 不能通过普通文件命令修改。
- [ ] archive round-trip 后文件、HEAD 和 hash 一致。
- [ ] dirty working tree checkout 被拒绝。

#### Migration

- [ ] 路径和内容完整迁移。
- [ ] initial import commit 包含全部文件。
- [ ] source revision 变化导致 activate 失败。
- [ ] snapshot 上传失败不切 storage kind。
- [ ] activate 成功后不读取 legacy files。
- [ ] 本地缺失可以从 active snapshot 恢复。

#### Agent tool protocol

- [ ] Database/Git 文件工具执行位置正确。
- [ ] toolCallId 只能闭合一次。
- [ ] 伪造、晚到、跨项目 result 被拒绝。
- [ ] stop 后不执行新 mutation。
- [ ] conflict 不退化为覆盖。

### 22.2 手工/浏览器集成验证

- [ ] 打开升级前旧项目并完成编辑/聊天/预览。
- [ ] 新建 Database 项目。
- [ ] 新建 Browser Git 项目。
- [ ] 将有多文件的旧项目迁移为 Git。
- [ ] 刷新后恢复本地 Git 项目。
- [ ] 清除本地 repository 后从 Blob 恢复。
- [ ] commit 后查看 status/log/diff。
- [ ] checkout 后 Editor/File tree/Preview 一致。
- [ ] 迁移中关闭页面后能够明确重试或取消。

### 22.3 不新增的测试

- 不为按钮文案、图标或简单 label 编写测试。
- 不为纯类型同步编写重复测试。
- 不为没有业务不变量的 UI 包装组件编写测试。

---

## 23. 验收清单

功能完成必须同时满足：

- [ ] 旧项目无回归。
- [ ] 新项目可以显式选择 Database/Git。
- [ ] Database 项目后续可以安全启用 Git。
- [ ] 任一项目不存在双写路径。
- [ ] Git 项目所有文件 mutation 只经过 Repository Worker。
- [ ] Database 项目所有文件 mutation 只经过服务端文件层。
- [ ] Git 项目可以刷新/云端恢复。
- [ ] Agent 可以修改 Git 项目并收到真实结果。
- [ ] Preview 与 workspace revision 绑定。
- [ ] Migration 失败不会破坏原 Database 项目。
- [ ] 未知字段、状态、action 和 archive version 不会被猜测修复。
- [ ] 所有冲突和恢复路径都有可诊断信息。

---

## 24. 推荐实施顺序

```text
需求与契约冻结
      ↓
Schema + revision + storage guard
      ↓
ProjectRepository + Database adapter
      ↓
Browser Repository Worker
      ↓
Repository snapshot + recovery
      ↓
新项目 provisioning
      ↓
旧项目启用 Git migration
      ↓
Agent client file tools
      ↓
Editor/Preview revision integration
      ↓
Git status/commit/log/branch UI
      ↓
观察、清理、再评估 Git remote
```

不建议改变顺序：如果在 storage guard、revision、snapshot recovery 和 client tool pairing 之前开放“启用 Git”，会产生无法可靠恢复的双源项目。
