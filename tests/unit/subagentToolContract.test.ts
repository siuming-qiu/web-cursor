import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  FollowupTaskArgsSchema,
  InterruptAgentArgsSchema,
  SendMessageArgsSchema,
  SpawnAgentArgsSchema,
  WaitAgentArgsSchema,
} from "../../types/toolSchema";
import {
  FollowupTaskResultSchema,
  InterruptAgentResultSchema,
  SendMessageResultSchema,
  SpawnAgentResultSchema,
  ToolExecutionErrorCode,
  WaitAgentResultSchema,
  validatePersistedToolResult,
} from "../../types/toolResult";
import { AgentToolEffect, AgentToolExecutionDomain } from "../../types/agentRun";
import { ProjectStorageKind } from "../../types/projectStorage";
import { SubagentProfileId, SubagentTaskStatus } from "../../types/subagent";
import { ToolName } from "../../types/tool";

type AgentToolPolicyModule = typeof import("../../server/tools/agentToolPolicy");
type AgentProfilesModule = typeof import("../../server/agentProfiles");

let agentToolEffect: AgentToolPolicyModule["agentToolEffect"];
let agentToolExecutionDomain: AgentToolPolicyModule["agentToolExecutionDomain"];
let serverToolRequiresRunTransaction:
  AgentToolPolicyModule["serverToolRequiresRunTransaction"];
let resolveSubagentProfile: AgentProfilesModule["resolveSubagentProfile"];
let SubagentProfileError: AgentProfilesModule["SubagentProfileError"];
let SubagentProfileErrorCode: AgentProfilesModule["SubagentProfileErrorCode"];

beforeAll(async () => {
  ({
    agentToolEffect,
    agentToolExecutionDomain,
    serverToolRequiresRunTransaction,
  } = await import("../../server/tools/agentToolPolicy"));
  ({
    resolveSubagentProfile,
    SubagentProfileError,
    SubagentProfileErrorCode,
  } = await import("../../server/agentProfiles"));
});

const agentId = "11111111-1111-4111-8111-111111111111";

const controlToolNames = [
  ToolName.SpawnAgent,
  ToolName.WaitAgent,
  ToolName.SendMessage,
  ToolName.FollowupTask,
  ToolName.InterruptAgent,
] as const;

describe("subagent control tool argument contracts", () => {
  it("accepts only the explicit explorer spawn contract", () => {
    expect(SpawnAgentArgsSchema.parse({
      message: "Inspect the repository boundary",
      profile: SubagentProfileId.Explorer,
    })).toEqual({
      message: "Inspect the repository boundary",
      profile: SubagentProfileId.Explorer,
    });

    expect(SpawnAgentArgsSchema.safeParse({
      message: "   ",
      profile: SubagentProfileId.Explorer,
    }).success).toBe(false);
    expect(SpawnAgentArgsSchema.safeParse({
      message: "Inspect the repository boundary",
      profile: "general-purpose",
    }).success).toBe(false);
    expect(SpawnAgentArgsSchema.safeParse({
      message: "Inspect the repository boundary",
      profile: SubagentProfileId.Explorer,
      context: "full",
    }).success).toBe(false);
  });

  it("requires UUID targets and rejects unknown control-message fields", () => {
    expect(WaitAgentArgsSchema.safeParse({ target: agentId }).success).toBe(true);
    expect(InterruptAgentArgsSchema.safeParse({ target: agentId }).success).toBe(true);
    expect(WaitAgentArgsSchema.safeParse({ target: "child-1" }).success).toBe(false);
    expect(InterruptAgentArgsSchema.safeParse({
      target: agentId,
      recursive: true,
    }).success).toBe(false);

    for (const schema of [SendMessageArgsSchema, FollowupTaskArgsSchema]) {
      expect(schema.safeParse({ target: agentId, message: "Use the current schema" }).success)
        .toBe(true);
      expect(schema.safeParse({ target: agentId, message: "\n\t" }).success)
        .toBe(false);
      expect(schema.safeParse({
        target: agentId,
        message: "Use the current schema",
        triggerTurn: true,
      }).success).toBe(false);
    }
  });
});

describe("subagent control tool result contracts", () => {
  it("keeps spawn, message, follow-up, and interrupt results strict", () => {
    expect(SpawnAgentResultSchema.safeParse({
      status: "ok",
      tool: ToolName.SpawnAgent,
      agentId,
      taskStatus: SubagentTaskStatus.Running,
    }).success).toBe(true);
    expect(SpawnAgentResultSchema.safeParse({
      status: "ok",
      tool: ToolName.SpawnAgent,
      agentId,
      taskStatus: SubagentTaskStatus.Completed,
    }).success).toBe(false);

    expect(SendMessageResultSchema.safeParse({
      status: "ok",
      tool: ToolName.SendMessage,
      agentId,
      accepted: true,
    }).success).toBe(true);
    expect(FollowupTaskResultSchema.safeParse({
      status: "ok",
      tool: ToolName.FollowupTask,
      agentId,
      accepted: false,
    }).success).toBe(false);
    expect(InterruptAgentResultSchema.safeParse({
      status: "ok",
      tool: ToolName.InterruptAgent,
      agentId,
      previousTaskStatus: SubagentTaskStatus.Running,
      currentTaskStatus: SubagentTaskStatus.Interrupted,
    }).success).toBe(true);
    expect(InterruptAgentResultSchema.safeParse({
      status: "ok",
      tool: ToolName.InterruptAgent,
      agentId,
      previousTaskStatus: SubagentTaskStatus.Running,
      currentTaskStatus: SubagentTaskStatus.Completed,
    }).success).toBe(false);
    expect(InterruptAgentResultSchema.safeParse({
      status: "ok",
      tool: ToolName.InterruptAgent,
      agentId,
      previousTaskStatus: SubagentTaskStatus.Completed,
      currentTaskStatus: SubagentTaskStatus.Completed,
    }).success).toBe(true);
  });

  it("enforces terminal wait payload invariants", () => {
    const base = {
      status: "ok",
      tool: ToolName.WaitAgent,
      agentId,
    } as const;

    expect(WaitAgentResultSchema.safeParse({
      ...base,
      taskStatus: SubagentTaskStatus.Completed,
      output: "Repository findings",
    }).success).toBe(true);
    expect(WaitAgentResultSchema.safeParse({
      ...base,
      taskStatus: SubagentTaskStatus.Completed,
    }).success).toBe(false);
    expect(WaitAgentResultSchema.safeParse({
      ...base,
      taskStatus: SubagentTaskStatus.Completed,
      output: "Repository findings",
      error: "unexpected",
    }).success).toBe(false);

    expect(WaitAgentResultSchema.safeParse({
      ...base,
      taskStatus: SubagentTaskStatus.Failed,
      error: "Child failed",
    }).success).toBe(true);
    expect(WaitAgentResultSchema.safeParse({
      ...base,
      taskStatus: SubagentTaskStatus.Failed,
      error: "Child failed",
      output: "partial",
    }).success).toBe(false);

    expect(WaitAgentResultSchema.safeParse({
      ...base,
      taskStatus: SubagentTaskStatus.Interrupted,
    }).success).toBe(true);
    expect(WaitAgentResultSchema.safeParse({
      ...base,
      taskStatus: SubagentTaskStatus.Interrupted,
      output: "late output",
    }).success).toBe(false);
    expect(WaitAgentResultSchema.safeParse({
      ...base,
      taskStatus: SubagentTaskStatus.Interrupted,
      error: "unexpected error",
    }).success).toBe(false);
    expect(WaitAgentResultSchema.safeParse({
      ...base,
      taskStatus: SubagentTaskStatus.Running,
    }).success).toBe(false);
  });

  it("allows only the shared control-tool error codes", () => {
    for (const tool of controlToolNames) {
      for (const code of [
        ToolExecutionErrorCode.BadArgs,
        ToolExecutionErrorCode.NotFound,
        ToolExecutionErrorCode.Conflict,
        ToolExecutionErrorCode.Unsupported,
        ToolExecutionErrorCode.InternalError,
      ]) {
        expect(validatePersistedToolResult(tool, {
          status: "error",
          tool,
          code,
          message: "explicit failure",
        }).success).toBe(true);
      }
      expect(validatePersistedToolResult(tool, {
        status: "error",
        tool,
        code: ToolExecutionErrorCode.BadPath,
        message: "wrong error domain",
      }).success).toBe(false);
    }
  });
});

describe("subagent control tool policy", () => {
  it("keeps every control tool server-side and fences lifecycle mutations with the Parent Run transaction", () => {
    for (const tool of controlToolNames) {
      expect(agentToolExecutionDomain(tool, ProjectStorageKind.Database))
        .toBe(AgentToolExecutionDomain.Server);
      expect(agentToolExecutionDomain(tool, ProjectStorageKind.BrowserGit))
        .toBe(AgentToolExecutionDomain.Server);
    }
    for (const tool of [
      ToolName.SpawnAgent,
      ToolName.SendMessage,
      ToolName.FollowupTask,
      ToolName.InterruptAgent,
    ]) {
      expect(serverToolRequiresRunTransaction(tool, ProjectStorageKind.Database))
        .toBe(true);
      expect(serverToolRequiresRunTransaction(tool, ProjectStorageKind.BrowserGit))
        .toBe(true);
    }
    expect(serverToolRequiresRunTransaction(
      ToolName.WaitAgent,
      ProjectStorageKind.Database,
    )).toBe(false);
  });

  it("classifies lifecycle-changing controls as mutations and wait as read", () => {
    expect(agentToolEffect(ToolName.SpawnAgent)).toBe(AgentToolEffect.Mutation);
    expect(agentToolEffect(ToolName.WaitAgent)).toBe(AgentToolEffect.Read);
    expect(agentToolEffect(ToolName.SendMessage)).toBe(AgentToolEffect.Mutation);
    expect(agentToolEffect(ToolName.FollowupTask)).toBe(AgentToolEffect.Mutation);
    expect(agentToolEffect(ToolName.InterruptAgent)).toBe(AgentToolEffect.Mutation);
  });

  it("keeps the Explorer model toolset and execution allowlist read-only and rejects BrowserGit", () => {
    const profile = resolveSubagentProfile({
      profileId: SubagentProfileId.Explorer,
      locale: "zh",
      storageKind: ProjectStorageKind.Database,
    });
    const modelVisibleTools = profile.tools.map((tool) => tool.function.name);

    expect(modelVisibleTools).toEqual([
      ToolName.ListFiles,
      ToolName.SearchText,
      ToolName.ReadFile,
    ]);
    expect([...profile.allowedTools]).toEqual(modelVisibleTools);
    expect(() => resolveSubagentProfile({
      profileId: SubagentProfileId.Explorer,
      locale: "zh",
      storageKind: ProjectStorageKind.BrowserGit,
    })).toThrowError(SubagentProfileError);

    try {
      resolveSubagentProfile({
        profileId: SubagentProfileId.Explorer,
        locale: "zh",
        storageKind: ProjectStorageKind.BrowserGit,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SubagentProfileError);
      expect((error as InstanceType<typeof SubagentProfileError>).code).toBe(
        SubagentProfileErrorCode.UnsupportedStorage,
      );
    }
  });
});
