import { expect, test, type Page, type Route } from "@playwright/test";

const PROJECT_ID = "772cc805-cf12-4b10-b19d-9b4241e68af7";
const CONVERSATION_ID = "21a25592-5e6c-469d-b37f-1bca2ceadf83";
const AGENT_RUN_ID = "d4bfaf7e-4ab5-49e2-a7af-402da07d21a7";
const LIST_INVOCATION_ID = "56071dc3-3d80-4b0c-9dc1-3a8d3ebcb6eb";
const WRITE_INVOCATION_ID = "45933ddd-5de1-47db-a81f-7b9d32114edb";
const CREATED_AT = "2026-07-17T08:00:00.000Z";
const README_CONTENT = "# E2E Browser Git\n";

type JsonRecord = Record<string, unknown>;

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: "zh",
    url: "http://127.0.0.1:3100",
  }]);
});

function sse(events: JsonRecord[]) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

async function fulfillSse(route: Route, events: JsonRecord[]) {
  await route.fulfill({
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
    body: sse(events),
  });
}

function browserGitProject(id = PROJECT_ID) {
  return {
    id,
    title: "untitled",
    storageKind: "browser_git_v1",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function agentRun(
  projectId: string,
  requestId: string,
  status: "waiting_client_tool" | "waiting_feedback" | "completed",
  attempt: number,
) {
  return {
    id: AGENT_RUN_ID,
    projectId,
    conversationId: CONVERSATION_ID,
    requestId,
    trigger: "user",
    status,
    attempt,
    modelRounds: 1,
    toolRounds: 1,
    maxModelRounds: 24,
    maxToolRounds: 24,
    repository: {
      projectId,
      storageKind: "browser_git_v1",
      revision: 0,
    },
    failure: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    startedAt: CREATED_AT,
    cancelRequestedAt: null,
    completedAt: status === "completed" ? CREATED_AT : null,
  };
}

async function installBrowserGitFlow(page: Page) {
  const toolResults: JsonRecord[] = [];
  const invocationStarts: JsonRecord[] = [];
  const chatTurns: JsonRecord[] = [];
  let createdProjectId: string | null = null;
  let resumeCount = 0;
  let requestId: string | null = null;

  await page.route("**/api/projects", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, json: [] });
      return;
    }
    const body = request.postDataJSON() as JsonRecord;
    createdProjectId = String(body.id);
    expect(body).toEqual({
      id: createdProjectId,
      title: "untitled",
      storageKind: "browser_git_v1",
    });
    await route.fulfill({ status: 201, json: [browserGitProject(createdProjectId)] });
  });

  await page.route(/\/api\/projects\/[0-9a-f-]+$/, async (route) => {
    const id = route.request().url().split("/").at(-1)!;
    await route.fulfill({
      status: 200,
      json: { ...browserGitProject(id), conversations: [] },
    });
  });

  await page.route(new RegExp(`/api/agent-runs/${AGENT_RUN_ID}/tool-invocations/[0-9a-f-]+/start$`), async (route) => {
    expect(route.request().method()).toBe("POST");
    invocationStarts.push(route.request().postDataJSON() as JsonRecord);
    await route.fulfill({ status: 204, body: "" });
  });

  await page.route(new RegExp(`/api/agent-runs/${AGENT_RUN_ID}/tool-invocations/[0-9a-f-]+/result$`), async (route) => {
    expect(route.request().method()).toBe("POST");
    toolResults.push(route.request().postDataJSON() as JsonRecord);
    await route.fulfill({ status: 204, body: "" });
  });

  await page.route(new RegExp(`/api/agent-runs/${AGENT_RUN_ID}/complete$`), async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({});
    expect(createdProjectId).not.toBeNull();
    expect(requestId).not.toBeNull();
    await route.fulfill({
      status: 200,
      json: agentRun(createdProjectId!, requestId!, "completed", 3),
    });
  });

  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as JsonRecord;
    chatTurns.push(body);
    if (body.kind === "user") {
      expect(body.projectId).toBe(createdProjectId);
      requestId = String(body.requestId);
      await fulfillSse(route, [
        {
          type: "init",
          agentRunId: AGENT_RUN_ID,
          attempt: 1,
          conversationId: CONVERSATION_ID,
          repository: {
            projectId: createdProjectId,
            storageKind: "browser_git_v1",
            revision: 0,
          },
        },
        {
          type: "run_state",
          agentRunId: AGENT_RUN_ID,
          attempt: 1,
          run: agentRun(createdProjectId!, requestId!, "waiting_client_tool", 1),
        },
        {
          type: "tools_call",
          agentRunId: AGENT_RUN_ID,
          attempt: 1,
          index: 0,
          id: "call-list",
          name: "list_files",
        },
        {
          type: "client_tool_calls",
          agentRunId: AGENT_RUN_ID,
          attempt: 1,
          calls: [{
            id: "call-list",
            name: "list_files",
            arguments: "{}",
            invocationId: LIST_INVOCATION_ID,
            agentRunId: AGENT_RUN_ID,
            attempt: 1,
          }],
        },
        { type: "done", agentRunId: AGENT_RUN_ID, attempt: 1 },
      ]);
      return;
    }

    expect(body).toEqual({
      kind: "resume",
      conversationId: CONVERSATION_ID,
      runId: AGENT_RUN_ID,
      attempt: resumeCount + 1,
    });
    if (resumeCount === 0) {
      resumeCount += 1;
      await fulfillSse(route, [
        {
          type: "run_state",
          agentRunId: AGENT_RUN_ID,
          attempt: 2,
          run: agentRun(createdProjectId!, requestId!, "waiting_client_tool", 2),
        },
        {
          type: "tools_call",
          agentRunId: AGENT_RUN_ID,
          attempt: 2,
          index: 0,
          id: "call-write",
          name: "write_file",
        },
        {
          type: "client_tool_calls",
          agentRunId: AGENT_RUN_ID,
          attempt: 2,
          calls: [{
            id: "call-write",
            name: "write_file",
            arguments: JSON.stringify({
              path: "README.md",
              content: README_CONTENT,
              expectedRevision: 0,
            }),
            invocationId: WRITE_INVOCATION_ID,
            agentRunId: AGENT_RUN_ID,
            attempt: 2,
          }],
        },
        { type: "done", agentRunId: AGENT_RUN_ID, attempt: 2 },
      ]);
      return;
    }

    await fulfillSse(route, [
      {
        type: "chat",
        agentRunId: AGENT_RUN_ID,
        attempt: 3,
        delta: "Browser Git E2E completed",
      },
      {
        type: "run_state",
        agentRunId: AGENT_RUN_ID,
        attempt: 3,
        run: agentRun(createdProjectId!, requestId!, "waiting_feedback", 3),
      },
      { type: "done", agentRunId: AGENT_RUN_ID, attempt: 3 },
    ]);
  });

  return {
    toolResults,
    invocationStarts,
    chatTurns,
    createdProjectId: () => createdProjectId,
  };
}

test("user can select Browser Git, let Agent write locally, and reopen after refresh", async ({ page }) => {
  const flow = await installBrowserGitFlow(page);
  await page.goto("/");

  const database = page.getByRole("button", { name: /Database/ });
  const browserGit = page.getByRole("button", { name: /Browser Git/ });
  await expect(database).toHaveAttribute("aria-pressed", "true");
  await expect(browserGit).toHaveAttribute("aria-pressed", "false");

  await browserGit.click();
  await expect(browserGit).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("本地存储：清除站点数据、换浏览器或换设备后无法恢复。")).toBeVisible();

  await page.getByRole("textbox").fill("创建 Browser Git E2E 项目说明");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("Browser Git E2E completed")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('button[title="README.md"]')).toBeVisible();
  await expect.poll(() => flow.toolResults.length).toBe(2);
  await expect.poll(() => flow.invocationStarts.length).toBe(2);

  const projectId = flow.createdProjectId();
  expect(projectId).toMatch(/^[0-9a-f-]{36}$/);
  expect(flow.chatTurns).toEqual([
    expect.objectContaining({
      kind: "user",
      message: "创建 Browser Git E2E 项目说明",
      projectId,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }),
    { kind: "resume", conversationId: CONVERSATION_ID, runId: AGENT_RUN_ID, attempt: 1 },
    { kind: "resume", conversationId: CONVERSATION_ID, runId: AGENT_RUN_ID, attempt: 2 },
  ]);
  expect(flow.invocationStarts).toEqual([{ attempt: 1 }, { attempt: 2 }]);
  expect(flow.toolResults).toEqual([
    {
      projectId,
      toolCallId: "call-list",
      invocationId: LIST_INVOCATION_ID,
      agentRunId: AGENT_RUN_ID,
      attempt: 1,
      tool: "list_files",
      result: { status: "ok", tool: "list_files", revision: 0, files: [] },
    },
    {
      projectId,
      toolCallId: "call-write",
      invocationId: WRITE_INVOCATION_ID,
      agentRunId: AGENT_RUN_ID,
      attempt: 2,
      tool: "write_file",
      result: expect.objectContaining({
        status: "ok",
        tool: "write_file",
        revision: 1,
        path: "README.md",
      }),
    },
  ]);

  await expect(page).toHaveURL(`/p/${projectId}`);
  await page.reload();
  await expect(page.locator('button[title="README.md"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('section div[title="README.md"]')).toBeVisible();
});

test("project metadata without a local repository shows the explicit missing state", async ({ page }) => {
  const missingProjectId = "32ef75e4-1226-42ef-a026-8d851d5b7533";
  await page.route(new RegExp(`/api/projects/${missingProjectId}$`), async (route) => {
    await route.fulfill({
      status: 200,
      json: { ...browserGitProject(missingProjectId), conversations: [] },
    });
  });

  await page.goto(`/p/${missingProjectId}`);
  await expect(page.getByRole("heading", { name: "当前浏览器中找不到这个 Git 仓库" })).toBeVisible();
  await expect(page.getByText(/不会创建空仓库或回退到数据库/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
});

test("existing Database project migrates to Browser Git and reopens from the local repository", async ({ page }) => {
  const migrationProjectId = "e3955533-56a7-4934-8fe8-923f8f938a57";
  const sourceRevision = 4;
  const sourceContent = "# migrated Database project\n";
  let activated = false;
  let activationBody: JsonRecord | null = null;

  await page.route(new RegExp(`/api/projects/${migrationProjectId}$`), async (route) => {
    await route.fulfill({
      status: 200,
      json: activated
        ? { ...browserGitProject(migrationProjectId), title: "Legacy project", conversations: [] }
        : {
            id: migrationProjectId,
            title: "Legacy project",
            storageKind: "database_v1",
            codeRevision: sourceRevision,
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            conversations: [],
            files: [{ path: "README.md", updatedAt: CREATED_AT }],
          },
    });
  });

  await page.route(new RegExp(`/api/projects/${migrationProjectId}/migrate-browser-git$`), async (route) => {
    expect(route.request().method()).toBe("POST");
    activationBody = route.request().postDataJSON() as JsonRecord;
    expect(activationBody).toMatchObject({
      sourceRevision,
      localRevision: sourceRevision,
    });
    expect(activationBody).not.toHaveProperty("action");
    expect(String(activationBody.importCommitOid)).toMatch(/^[0-9a-f]{40}$/);
    activated = true;
    await route.fulfill({
      status: 200,
      json: { ...browserGitProject(migrationProjectId), title: "Legacy project" },
    });
  });

  await page.route(new RegExp(`/api/projects/${migrationProjectId}/files\\?includeContent=1$`), async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        revision: sourceRevision,
        files: [{ path: "README.md", content: sourceContent, updatedAt: CREATED_AT }],
      },
    });
  });

  await page.goto(`/p/${migrationProjectId}`);
  await expect(page.getByText("当前源码存储：Database")).toBeVisible();
  await expect(page.locator('button[title="README.md"]')).toBeVisible();
  await page.locator('button[title="README.md"]').click();
  const editorWorkspace = page.getByTestId("editor-workspace");
  await expect(editorWorkspace).toBeVisible();
  const editorWorkspaceBox = await editorWorkspace.boundingBox();
  expect(editorWorkspaceBox?.height).toBeGreaterThan(300);
  await page.getByRole("button", { name: "转换为浏览器 Git" }).click();

  const dialog = page.getByRole("dialog", { name: "将项目转换为浏览器 Git" });
  await expect(dialog.getByText(/本期不提供云端同步/)).toBeVisible();
  await dialog.getByLabel("Git 作者姓名").fill("E2E Migration User");
  await dialog.getByLabel("Git 作者邮箱").fill("migration-e2e@example.com");
  await dialog.getByRole("button", { name: "确认转换" }).click();

  await expect(page.getByText("当前源码存储：浏览器 Git")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('button[title="README.md"]')).toBeVisible();
  expect(activated).toBe(true);
  expect(activationBody).not.toBeNull();

  await page.reload();
  await expect(page.getByText("当前源码存储：浏览器 Git")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('button[title="README.md"]')).toBeVisible();
  await page.locator('button[title="README.md"]').click();
  await expect(page.locator('section div[title="README.md"]')).toBeVisible();
});
