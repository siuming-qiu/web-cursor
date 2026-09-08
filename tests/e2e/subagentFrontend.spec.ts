import { expect, test, type Page } from "@playwright/test";
import type { ChatEvent } from "../../types/chat";
import type { SubagentProgress } from "../../types/subagent";

const PROJECT_ID = "80754ce3-42d9-4419-a2e0-23a14d0ed7d7";
const CONVERSATION_ID = "967346a8-cf79-4da9-a4b1-cf0d5a8573c7";
const AGENT_RUN_ID = "7f88be8d-3b9a-4db2-9297-ae074eece3f1";
const FIRST_CHILD_AGENT_ID = "d16815e2-e135-4b98-abf7-43f182665bfc";
const SECOND_CHILD_AGENT_ID = "94c22d75-281b-4288-853a-d3819617a3f6";
const TIMESTAMP = "2026-08-12T08:00:00.000Z";
const PRE_SPAWN_TEXT = "我先让两个 Sub-agent 分别检查相关实现。";
const FINAL_TEXT = "最终结论：两个 Sub-agent 都已完成调查。";

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: "zh",
    url: "http://127.0.0.1:3100",
  }]);
});

function databaseProject() {
  return {
    id: PROJECT_ID,
    title: "Sub-agent frontend projection",
    storageKind: "database_v1",
    codeRevision: 0,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    conversations: [],
    files: [],
  };
}

function agentRun(
  requestId: string,
  status: "running" | "waiting_feedback" | "completed",
) {
  return {
    id: AGENT_RUN_ID,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    requestId,
    trigger: "user",
    status,
    attempt: 1,
    modelRounds: 1,
    toolRounds: 2,
    maxModelRounds: 24,
    maxToolRounds: 24,
    repository: {
      projectId: PROJECT_ID,
      storageKind: "database_v1",
      revision: 0,
    },
    failure: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    startedAt: TIMESTAMP,
    cancelRequestedAt: null,
    completedAt: status === "completed" ? TIMESTAMP : null,
  };
}

// Controlled SSE fixtures verify the browser projection. The real server chain is
// exercised separately by chatSubagentIntegration.test.ts.
async function installDatabaseProject(page: Page, ending: "completed" | "failed" | "disconnected" | "history" | "parent_done" | "snapshot" = "completed") {
  await page.route(new RegExp(`/api/projects/${PROJECT_ID}$`), async (route) => {
    await route.fulfill({ status: 200, json: databaseProject() });
  });
  await page.route(new RegExp(`/api/projects/${PROJECT_ID}/files\\?includeContent=1$`), async (route) => {
    await route.fulfill({ status: 200, json: { revision: 0, files: [] } });
  });
  await page.route(new RegExp(`/api/agent-runs/${AGENT_RUN_ID}/complete$`), async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({});
    const requestId = await page.evaluate(() => {
      const testState = window as typeof window & {
        __subagentFrontendChatRequestId?: string;
      };
      return testState.__subagentFrontendChatRequestId ?? null;
    });
    expect(requestId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    await route.fulfill({ status: 200, json: agentRun(requestId!, "completed") });
  });

  await page.addInitScript(({
    agentRunId,
    conversationId,
    firstChildAgentId,
    projectId,
    secondChildAgentId,
    timestamp,
    ending,
  }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== "/api/chat") return originalFetch(input, init);

      const body = JSON.parse(String(init?.body)) as { requestId?: unknown };
      if (typeof body.requestId !== "string") {
        return new Response("missing requestId", { status: 400 });
      }
      const requestId = body.requestId;
      const testState = window as typeof window & {
        __subagentFrontendChatRequestId?: string;
      };
      testState.__subagentFrontendChatRequestId = body.requestId;
      const run = (status: "running" | "waiting_feedback") => ({
        id: agentRunId,
        projectId,
        conversationId,
        requestId,
        trigger: "user" as const,
        status,
        attempt: 1,
        modelRounds: 1,
        toolRounds: 2,
        maxModelRounds: 24,
        maxToolRounds: 24,
        repository: { projectId, storageKind: "database_v1" as const, revision: 0 },
        failure: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: timestamp,
        cancelRequestedAt: null,
        completedAt: null,
      });
      const events: ChatEvent[] = [
        {
          type: "init",
          agentRunId,
          attempt: 1,
          conversationId,
          repository: run("running").repository,
        },
        { type: "run_state", agentRunId, attempt: 1, run: run("running") },
        {
          type: "chat",
          agentRunId,
          attempt: 1,
          delta: "我先让两个 Sub-agent 分别检查相关实现。",
        },
        {
          type: "tools_call",
          agentRunId,
          attempt: 1,
          index: 0,
          id: "spawn-child",
          name: "spawn_agent",
        },
        {
          type: "tool_result",
          agentRunId,
          attempt: 1,
          name: "spawn_agent",
          status: "ok",
        },
        {
          type: "subagent_activity",
          agentRunId,
          attempt: 1,
          activity: {
            kind: "started",
            agentId: firstChildAgentId,
            profileId: "explorer",
            task: "检查状态定义、状态转换和 UI 展示",
          },
        },
        {
          type: "tools_call",
          agentRunId,
          attempt: 1,
          index: 1,
          id: "wait-child",
          name: "wait_agent",
        },
        {
          type: "subagent_activity",
          agentRunId,
          attempt: 1,
          activity: {
            kind: "tool_started",
            agentId: firstChildAgentId,
            toolCallId: "child-list-files",
            toolName: "list_files",
          },
        },
        {
          type: "subagent_activity",
          agentRunId,
          attempt: 1,
          activity: {
            kind: "tool_started",
            agentId: firstChildAgentId,
            toolCallId: "child-search-text",
            toolName: "search_text",
            detail: "CampaignStatus",
          },
        },
        {
          type: "subagent_activity",
          agentRunId,
          attempt: 1,
          activity: {
            kind: "tool_started",
            agentId: firstChildAgentId,
            toolCallId: "child-read-file",
            toolName: "read_file",
            detail: "src/state.ts",
          },
        },
        {
          type: "subagent_activity",
          agentRunId,
          attempt: 1,
          activity: {
            kind: "model_output",
            agentId: firstChildAgentId,
          },
        },
        {
          type: "subagent_activity",
          agentRunId,
          attempt: 1,
          activity: {
            kind: "status_changed",
            agentId: firstChildAgentId,
            status: "completed",
          },
        },
        { type: "tool_result", agentRunId, attempt: 1, name: "wait_agent", status: "ok" },
        {
          type: "tools_call",
          agentRunId,
          attempt: 1,
          index: 0,
          id: "spawn-second-child",
          name: "spawn_agent",
        },
        {
          type: "tool_result",
          agentRunId,
          attempt: 1,
          name: "spawn_agent",
          status: "ok",
        },
        {
          type: "subagent_activity",
          agentRunId,
          attempt: 1,
          activity: {
            kind: "started",
            agentId: secondChildAgentId,
            profileId: "explorer",
            task: "复核组件交互与无障碍状态",
          },
        },
        {
          type: "tools_call",
          agentRunId,
          attempt: 1,
          index: 1,
          id: "wait-second-child",
          name: "wait_agent",
        },
        {
          type: "subagent_activity",
          agentRunId,
          attempt: 1,
          activity: {
            kind: "tool_started",
            agentId: secondChildAgentId,
            toolCallId: "second-child-read-file",
            toolName: "read_file",
          },
        },
        {
          type: "subagent_activity",
          agentRunId,
          attempt: 1,
          activity: {
            kind: "model_output",
            agentId: secondChildAgentId,
          },
        },
        {
          type: "subagent_activity",
          agentRunId,
          attempt: 1,
          activity: {
            kind: "status_changed",
            agentId: secondChildAgentId,
            status: "completed",
          },
        },
        { type: "tool_result", agentRunId, attempt: 1, name: "wait_agent", status: "ok" },
        {
          type: "chat",
          agentRunId,
          attempt: 1,
          delta: "最终结论：两个 Sub-agent 都已完成调查。",
        },
        { type: "run_state", agentRunId, attempt: 1, run: run("waiting_feedback") },
        { type: "done", agentRunId, attempt: 1 },
      ];
      // Add real tool completion boundaries. A finished tool must stop spinning
      // even while the Child itself is still running.
      const projectedEvents = events.flatMap<ChatEvent>((event) => {
        if (!("activity" in event) || event.activity?.kind !== "tool_started") return [event];
        return [event, {
          type: "subagent_activity", agentRunId, attempt: 1,
          activity: {
            kind: "tool_finished", agentId: event.activity.agentId,
            toolCallId: event.activity.toolCallId, status: "ok",
          },
        }];
      });
      const terminalIndex = projectedEvents.findIndex((event) => {
        if (!("activity" in event) || !event.activity) return false;
        return event.activity.kind === "status_changed"
          && event.activity.agentId === firstChildAgentId;
      });
      if (ending === "failed") {
        projectedEvents[terminalIndex] = {
          type: "subagent_activity", agentRunId, attempt: 1,
          activity: {
            kind: "status_changed", agentId: firstChildAgentId, status: "failed",
            failure: { code: "model_request_failed", message: "Sub-agent model request failed. Check the server logs for details." },
          },
        };
      }
      if (ending === "disconnected") projectedEvents.splice(terminalIndex);
      if (ending === "parent_done") {
        projectedEvents.splice(terminalIndex, projectedEvents.length - terminalIndex,
          { type: "run_state", agentRunId, attempt: 1, run: run("waiting_feedback") },
          { type: "done", agentRunId, attempt: 1 },
        );
      }
      if (ending === "snapshot") {
        const progress = projectedEvents.slice(0, terminalIndex).flatMap<SubagentProgress>((event) => {
          if (event.type !== "subagent_activity" || event.activity.agentId !== firstChildAgentId) return [];
          const activity = event.activity;
          if (activity.kind === "started" || activity.kind === "status_changed" || activity.kind === "snapshot") return [];
          const { agentId: _agentId, ...item } = activity;
          return [item];
        });
        projectedEvents[terminalIndex] = {
          type: "subagent_activity", agentRunId, attempt: 1,
          activity: {
            kind: "snapshot", agentId: firstChildAgentId, profileId: "explorer",
            task: "检查状态定义、状态转换和 UI 展示", status: "completed", progress,
          },
        };
      }
      if (ending === "history") {
        projectedEvents.splice(terminalIndex, 0, ...Array.from({ length: 7 }, (_, index): ChatEvent => ({
          type: "subagent_activity", agentRunId, attempt: 1,
          activity: { kind: "model_started", agentId: firstChildAgentId, round: index + 1 },
        })));
      }
      const encoder = new TextEncoder();
      const firstTerminalIndex = projectedEvents.findIndex((event) => {
        if (!("activity" in event) || !event.activity) return false;
        return event.activity.kind === "status_changed"
          && event.activity.agentId === firstChildAgentId;
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          projectedEvents.forEach((event, index) => {
            const terminalPause = index > firstTerminalIndex ? 1_800 : 0;
            window.setTimeout(() => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              if (index === projectedEvents.length - 1) {
                if (ending === "disconnected") controller.error(new Error("test network disconnect"));
                else controller.close();
              }
            }, index * 450 + terminalPause);
          });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      });
    };
  }, {
    agentRunId: AGENT_RUN_ID,
    conversationId: CONVERSATION_ID,
    firstChildAgentId: FIRST_CHILD_AGENT_ID,
    projectId: PROJECT_ID,
    secondChildAgentId: SECOND_CHILD_AGENT_ID,
    timestamp: TIMESTAMP,
    ending,
  });
}

test("Sub-agent activity stays ordered and updates each child card in place", async ({ page }) => {
  await installDatabaseProject(page);
  await page.goto(`/p/${PROJECT_ID}`);
  await page.getByRole("button", { name: "Preview" }).click();

  const composer = page.locator("#chat-composer");
  await expect(composer).toBeEnabled();
  await composer.fill("请委派 Child Agent 分析前端状态投影，并汇总结论。");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText(PRE_SPAWN_TEXT, { exact: true })).toBeVisible();
  await expect(page.getByText("正在启动 Child Agent", { exact: true }).first()).toBeVisible();
  const firstCard = page.locator(
    `[data-subagent-activity-card="${FIRST_CHILD_AGENT_ID}"]`,
  );
  await expect(firstCard).toHaveCount(1);
  await expect(firstCard.getByRole("status")).toContainText("运行中");
  await expect(firstCard.getByText("浏览项目结构", { exact: true })).toBeVisible();
  await expect(firstCard.getByText("搜索代码", { exact: true })).toBeVisible();
  await expect(firstCard.getByText("读取文件", { exact: true })).toBeVisible();
  await expect(firstCard.getByText("CampaignStatus", { exact: true })).toBeVisible();
  await expect(firstCard.getByText("src/state.ts", { exact: true })).toBeVisible();
  await expect(firstCard.locator("li .animate-spin")).toHaveCount(0);
  await expect(firstCard.getByText("收到模型输出", { exact: true })).toBeVisible();
  await expect(firstCard.getByRole("status")).toContainText("已完成");
  await expect(firstCard).toHaveCount(1);

  await expect(page.getByText("正在等待 Child Agent", { exact: true })).not.toBeVisible();
  await expect(page.getByText(FINAL_TEXT, { exact: true })).not.toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.getByText("正在等待 Child Agent", { exact: true })).not.toBeVisible();
  await expect(page.getByText(FINAL_TEXT, { exact: true })).not.toBeVisible();

  const secondCard = page.locator(
    `[data-subagent-activity-card="${SECOND_CHILD_AGENT_ID}"]`,
  );
  await expect(secondCard).toHaveCount(1);
  await expect(secondCard.getByRole("status")).toContainText("运行中");
  await expect(secondCard.getByRole("status")).toContainText("已完成");
  await expect(secondCard).toHaveCount(1);
  await expect(page.getByText(FINAL_TEXT, { exact: true })).toBeVisible();

  const timelineItems = page.locator(
    ".markdown-message, [data-subagent-activity-card]",
  );
  const timelineTexts = await timelineItems.allTextContents();
  const preSpawnIndex = timelineTexts.findIndex((text) => text.includes(PRE_SPAWN_TEXT));
  const firstCardIndex = timelineTexts.findIndex((text) =>
    text.includes("检查状态定义、状态转换和 UI 展示")
  );
  const secondCardIndex = timelineTexts.findIndex((text) =>
    text.includes("复核组件交互与无障碍状态")
  );
  const finalIndex = timelineTexts.findIndex((text) => text.includes(FINAL_TEXT));
  expect(preSpawnIndex).toBeGreaterThanOrEqual(0);
  expect(preSpawnIndex).toBeLessThan(firstCardIndex);
  expect(firstCardIndex).toBeLessThan(secondCardIndex);
  expect(secondCardIndex).toBeLessThan(finalIndex);

  await expect(page.getByText("调用后端失败")).not.toBeVisible();
  await expect(page.getByText("Agent Error")).not.toBeVisible();
  await expect(page.locator('[title="src/App.tsx"]')).toHaveCount(0);
});

test("Failed Child remains expanded with a safe diagnostic reason", async ({ page }) => {
  await installDatabaseProject(page, "failed");
  await page.goto(`/p/${PROJECT_ID}`);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.locator("#chat-composer").fill("检查项目的状态设计。");
  await page.getByRole("button", { name: "发送" }).click();
  const child = page.locator(`[data-subagent-activity-card="${FIRST_CHILD_AGENT_ID}"]`);
  await expect(child.getByRole("status")).toContainText("执行失败", { timeout: 15_000 });
  await expect(child.getByText("模型请求失败，请稍后重试。", { exact: true })).toBeVisible();
  await expect(child.getByText("src/state.ts", { exact: true })).toBeVisible();
  await expect(child.locator(".animate-spin")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("child-failure.png") });
});

test("Disconnected observation never fabricates a Child terminal status", async ({ page }) => {
  await installDatabaseProject(page, "disconnected");
  await page.goto(`/p/${PROJECT_ID}`);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.locator("#chat-composer").fill("检查项目的状态设计。");
  await page.getByRole("button", { name: "发送" }).click();
  const child = page.locator(`[data-subagent-activity-card="${FIRST_CHILD_AGENT_ID}"]`);
  await expect(child.getByText("实时更新已断开，最后状态：运行中", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(child.locator(".animate-spin")).toHaveCount(0);
  await expect(child).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("child-disconnected.png") });
});

test("Earlier Child activities remain accessible after the live tail grows", async ({ page }) => {
  await installDatabaseProject(page, "history");
  await page.goto(`/p/${PROJECT_ID}`);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.locator("#chat-composer").fill("系统检查项目的状态设计。");
  await page.getByRole("button", { name: "发送" }).click();
  const child = page.locator(`[data-subagent-activity-card="${FIRST_CHILD_AGENT_ID}"]`);
  await expect(child.getByRole("status")).toContainText("已完成", { timeout: 20_000 });
  await child.getByRole("button").first().click();
  await expect(child.getByText("浏览项目结构", { exact: true })).not.toBeVisible();
  await child.getByRole("button", { name: /查看全部/ }).click();
  await expect(child.getByText("浏览项目结构", { exact: true })).toBeVisible();
  await expect(child.getByText("src/state.ts", { exact: true })).toBeVisible();
  await child.getByRole("button", { name: "收起活动", exact: true }).click();
  await expect(child.getByText("浏览项目结构", { exact: true })).not.toBeVisible();
  await expect(child).toHaveCount(1);
});

test("Parent Done disconnects live observation without stopping the Child", async ({ page }) => {
  await installDatabaseProject(page, "parent_done");
  await page.goto(`/p/${PROJECT_ID}`);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.locator("#chat-composer").fill("检查项目的状态设计。");
  await page.getByRole("button", { name: "发送" }).click();
  const child = page.locator(`[data-subagent-activity-card="${FIRST_CHILD_AGENT_ID}"]`);
  await expect(child.getByText("实时更新已断开，最后状态：运行中", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(child.locator(".animate-spin")).toHaveCount(0);
  await expect(page.getByText("调用后端失败")).not.toBeVisible();
});

test("Authoritative snapshot replaces existing Child activities instead of duplicating them", async ({ page }) => {
  await installDatabaseProject(page, "snapshot");
  await page.goto(`/p/${PROJECT_ID}`);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.locator("#chat-composer").fill("检查项目的状态设计。");
  await page.getByRole("button", { name: "发送" }).click();
  const child = page.locator(`[data-subagent-activity-card="${FIRST_CHILD_AGENT_ID}"]`);
  await expect(child.getByRole("status")).toContainText("已完成", { timeout: 15_000 });
  await child.getByRole("button").first().click();
  await expect(child.getByText("src/state.ts", { exact: true })).toHaveCount(1);
  await expect(child.getByText("收到模型输出", { exact: true })).toHaveCount(1);
  await expect(child.locator("li")).toHaveCount(5);
  await expect(child).toHaveCount(1);
  await expect(child.locator(".animate-spin")).toHaveCount(0);
  await expect(page.getByText("调用后端失败")).not.toBeVisible();
});
