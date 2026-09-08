import { describe, expect, it } from "vitest";
import {
  AgentRunCompleteBodySchema,
  AgentRunRecoverBodySchema,
  AgentRunRequestStopBodySchema,
  AgentRunRequestStopOutcome,
  AgentRunRequestStopResponseSchema,
  AgentRunRestoreResponseSchema,
  AgentRunSnapshotSchema,
  AgentRunStartInvocationBodySchema,
  AgentRunStatus,
  AgentRunStopBodySchema,
  AgentRunTrigger,
  agentRunCanResume,
  agentRunCanTransition,
  agentRunIsOpen,
  agentRunIsTerminal,
  agentRunNeedsClientCompletion,
  type AgentRunStatus as AgentRunStatusValue,
} from "../../types/agentRun";
import { ProjectStorageKind } from "../../types/projectStorage";
import {
  ChatEventSchema,
  ChatEventType,
  ContextCompactionPhase,
} from "../../types/chat";
import {
  SubagentActivityKind,
  SubagentFailureCode,
  SubagentProfileId,
  SubagentTaskStatus,
} from "../../types/subagent";

const statuses = Object.values(AgentRunStatus);

const expectedSuccessors = {
  [AgentRunStatus.Running]: [
    AgentRunStatus.WaitingClientTool,
    AgentRunStatus.WaitingAsyncTool,
    AgentRunStatus.WaitingExternal,
    AgentRunStatus.WaitingFeedback,
    AgentRunStatus.WaitingResume,
    AgentRunStatus.Completed,
    AgentRunStatus.Failed,
    AgentRunStatus.Cancelled,
    AgentRunStatus.Blocked,
  ],
  [AgentRunStatus.WaitingClientTool]: [
    AgentRunStatus.WaitingResume,
    AgentRunStatus.Cancelled,
    AgentRunStatus.Blocked,
  ],
  [AgentRunStatus.WaitingAsyncTool]: [
    AgentRunStatus.WaitingResume,
    AgentRunStatus.Failed,
    AgentRunStatus.Cancelled,
    AgentRunStatus.Blocked,
  ],
  [AgentRunStatus.WaitingExternal]: [
    AgentRunStatus.Running,
    AgentRunStatus.Cancelled,
    AgentRunStatus.Blocked,
  ],
  [AgentRunStatus.WaitingResume]: [
    AgentRunStatus.Running,
    AgentRunStatus.Cancelled,
    AgentRunStatus.Blocked,
  ],
  [AgentRunStatus.WaitingFeedback]: [
    AgentRunStatus.Running,
    AgentRunStatus.Completed,
    AgentRunStatus.Cancelled,
    AgentRunStatus.Blocked,
  ],
  [AgentRunStatus.Blocked]: [
    AgentRunStatus.Cancelled,
  ],
  [AgentRunStatus.Completed]: [],
  [AgentRunStatus.Failed]: [],
  [AgentRunStatus.Cancelled]: [],
} as const satisfies Record<
  AgentRunStatusValue,
  readonly AgentRunStatusValue[]
>;

const snapshot = {
  id: "73ac6f75-e4a8-4f0a-891c-756f685f23db",
  projectId: "272330ae-d2cf-4b26-8d1c-1e94fac19890",
  conversationId: "9d984c26-1daa-4755-ab20-af4e07bcfef6",
  requestId: "0fafbe3e-d829-4206-b40f-d883afdf9aa9",
  trigger: AgentRunTrigger.User,
  status: AgentRunStatus.Running,
  attempt: 1,
  modelRounds: 0,
  toolRounds: 0,
  maxModelRounds: 8,
  maxToolRounds: 6,
  repository: {
    projectId: "272330ae-d2cf-4b26-8d1c-1e94fac19890",
    storageKind: ProjectStorageKind.Database,
    revision: 4,
  },
  failure: null,
  createdAt: "2026-07-25T08:00:00.000Z",
  updatedAt: "2026-07-25T08:00:01.000Z",
  startedAt: "2026-07-25T08:00:00.000Z",
  cancelRequestedAt: null,
  completedAt: null,
};

describe("AgentRun lifecycle contract", () => {
  it("allows exactly the declared transitions, with same-state updates reserved for idempotency", () => {
    for (const from of statuses) {
      for (const to of statuses) {
        const expected = from === to
          || expectedSuccessors[from].some((candidate) => candidate === to);
        expect(
          agentRunCanTransition(from, to),
          `${from} -> ${to}`,
        ).toBe(expected);
      }
    }
  });

  it("treats only completed, failed, and cancelled as terminal", () => {
    const terminal = new Set<AgentRunStatusValue>([
      AgentRunStatus.Completed,
      AgentRunStatus.Failed,
      AgentRunStatus.Cancelled,
    ]);

    for (const status of statuses) {
      expect(agentRunIsTerminal(status), status).toBe(terminal.has(status));
      expect(agentRunIsOpen(status), status).toBe(!terminal.has(status));
    }

    expect(agentRunIsOpen(AgentRunStatus.Blocked)).toBe(true);
    expect(agentRunCanTransition(
      AgentRunStatus.Blocked,
      AgentRunStatus.Cancelled,
    )).toBe(true);
  });

  it("keeps resumable and client-completion waits as disjoint explicit classes", () => {
    for (const status of statuses) {
      expect(agentRunCanResume(status), status).toBe(
        status === AgentRunStatus.WaitingResume
          || status === AgentRunStatus.WaitingExternal,
      );
      expect(agentRunNeedsClientCompletion(status), status).toBe(
        status === AgentRunStatus.WaitingFeedback,
      );
    }
  });
});

describe("AgentRun public API schemas", () => {
  it("restores either one strict public snapshot or no active run", () => {
    expect(AgentRunRestoreResponseSchema.parse({ run: snapshot })).toEqual({
      run: snapshot,
    });
    expect(AgentRunRestoreResponseSchema.parse({ run: null })).toEqual({
      run: null,
    });
  });

  it("rejects unknown control fields and never admits private lease or harness data", () => {
    expect(AgentRunSnapshotSchema.safeParse({
      ...snapshot,
      leaseId: "537d637a-3269-4a58-bbb1-bdc06afcc30a",
    }).success).toBe(false);
    expect(AgentRunSnapshotSchema.safeParse({
      ...snapshot,
      harnessIdentity: {},
    }).success).toBe(false);
    expect(AgentRunRestoreResponseSchema.safeParse({
      run: null,
      leaseId: "537d637a-3269-4a58-bbb1-bdc06afcc30a",
    }).success).toBe(false);
    expect(AgentRunStopBodySchema.safeParse({ reason: "guessed" }).success)
      .toBe(false);
    expect(AgentRunRequestStopBodySchema.safeParse({
      reason: "guessed",
    }).success).toBe(false);
    expect(AgentRunCompleteBodySchema.safeParse({ result: "guessed" }).success)
      .toBe(false);
    expect(AgentRunRecoverBodySchema.safeParse({
      attempt: 1,
      takeover: "guessed",
    }).success).toBe(false);
    expect(AgentRunStartInvocationBodySchema.safeParse({
      attempt: 1,
      leaseId: "537d637a-3269-4a58-bbb1-bdc06afcc30a",
    }).success).toBe(false);
  });

  it("distinguishes a durable pending request stop from a terminal run receipt", () => {
    const requestReceipt = {
      requestId: snapshot.requestId,
      requestedAt: "2026-07-25T08:00:02.000Z",
    };
    expect(AgentRunRequestStopResponseSchema.parse({
      ...requestReceipt,
      outcome: AgentRunRequestStopOutcome.PendingRun,
    })).toEqual({
      ...requestReceipt,
      outcome: AgentRunRequestStopOutcome.PendingRun,
    });
    expect(AgentRunRequestStopResponseSchema.parse({
      ...requestReceipt,
      outcome: AgentRunRequestStopOutcome.RunTerminal,
      run: {
        ...snapshot,
        status: AgentRunStatus.Cancelled,
        cancelRequestedAt: requestReceipt.requestedAt,
        completedAt: requestReceipt.requestedAt,
      },
    }).outcome).toBe(AgentRunRequestStopOutcome.RunTerminal);
    expect(AgentRunRequestStopResponseSchema.safeParse({
      ...requestReceipt,
      outcome: AgentRunRequestStopOutcome.PendingRun,
      run: snapshot,
    }).success).toBe(false);
    expect(AgentRunRequestStopResponseSchema.safeParse({
      ...requestReceipt,
      outcome: AgentRunRequestStopOutcome.RunTerminal,
    }).success).toBe(false);
    expect(AgentRunRequestStopResponseSchema.safeParse({
      ...requestReceipt,
      outcome: AgentRunRequestStopOutcome.RunTerminal,
      run: snapshot,
    }).success).toBe(false);
  });
});

describe("Context compaction SSE contract", () => {
  it("accepts only explicit started and completed phases", () => {
    const identity = {
      agentRunId: snapshot.id,
      attempt: snapshot.attempt,
      type: ChatEventType.ContextCompaction,
    };

    expect(ChatEventSchema.parse({
      ...identity,
      phase: ContextCompactionPhase.Started,
    })).toMatchObject({ phase: ContextCompactionPhase.Started });
    expect(ChatEventSchema.parse({
      ...identity,
      phase: ContextCompactionPhase.Completed,
    })).toMatchObject({ phase: ContextCompactionPhase.Completed });
    expect(ChatEventSchema.safeParse({
      ...identity,
      phase: "running",
    }).success).toBe(false);
    expect(ChatEventSchema.safeParse({
      ...identity,
      phase: ContextCompactionPhase.Started,
      percent: 50,
    }).success).toBe(false);
  });
});

describe("Sub-agent activity SSE contract", () => {
  const agentId = "11111111-1111-4111-8111-111111111111";
  const identity = {
    agentRunId: snapshot.id,
    attempt: snapshot.attempt,
    type: ChatEventType.SubagentActivity,
  } as const;

  it("accepts the explicit public activity union", () => {
    const activities = [
      {
        kind: SubagentActivityKind.Started,
        agentId,
        profileId: SubagentProfileId.Explorer,
        task: "Inspect project state handling",
      },
      {
        kind: SubagentActivityKind.ToolStarted,
        agentId,
        toolCallId: "call-1",
        toolName: "search_text",
      },
      { kind: SubagentActivityKind.ModelOutput, agentId },
      { kind: SubagentActivityKind.ModelStarted, agentId, round: 1 },
      { kind: SubagentActivityKind.ToolFinished, agentId, toolCallId: "call-1", status: "ok" },
      {
        kind: SubagentActivityKind.Snapshot,
        agentId,
        profileId: SubagentProfileId.Explorer,
        task: "Inspect project state handling",
        status: SubagentTaskStatus.Running,
        progress: [{ kind: SubagentActivityKind.ModelStarted, round: 1 }],
      },
      {
        kind: SubagentActivityKind.StatusChanged,
        agentId,
        status: SubagentTaskStatus.Completed,
      },
    ] as const;

    for (const activity of activities) {
      expect(ChatEventSchema.parse({ ...identity, activity }))
        .toMatchObject({ activity });
    }
  });

  it("rejects unknown identities, enum values, fields, and blank task/tool data", () => {
    const started = {
      kind: SubagentActivityKind.Started,
      agentId,
      profileId: SubagentProfileId.Explorer,
      task: "Inspect project state handling",
    } as const;
    const invalidActivities = [
      { ...started, agentId: "not-a-uuid" },
      { ...started, profileId: "guessed-profile" },
      { ...started, task: "   " },
      { ...started, ownerId: snapshot.id },
      {
        kind: SubagentActivityKind.ToolStarted,
        agentId,
        toolCallId: "   ",
        toolName: "search_text",
      },
      {
        kind: SubagentActivityKind.ToolStarted,
        agentId,
        toolCallId: "call-1",
        toolName: "   ",
      },
      {
        kind: SubagentActivityKind.StatusChanged,
        agentId,
        status: "queued",
      },
      {
        kind: "transcript_appended",
        agentId,
        transcript: "private child transcript",
      },
    ];

    for (const activity of invalidActivities) {
      expect(
        ChatEventSchema.safeParse({ ...identity, activity }).success,
        JSON.stringify(activity),
      ).toBe(false);
    }
  });

  it("requires safe diagnostic failures only on failed states, including reconnect snapshots", () => {
    const failure = {
      code: SubagentFailureCode.ModelRequestFailed,
      message: "Sub-agent model request failed. Check the server logs for details.",
    };
    const bases = [
      { kind: SubagentActivityKind.StatusChanged, agentId },
      {
        kind: SubagentActivityKind.Snapshot,
        agentId,
        profileId: SubagentProfileId.Explorer,
        task: "Inspect project state handling",
        progress: [],
      },
    ];
    for (const base of bases) {
      const failed = { ...base, status: SubagentTaskStatus.Failed, failure };
      expect(ChatEventSchema.safeParse({ ...identity, activity: failed }).success).toBe(true);
      for (const invalid of [
        { ...base, status: SubagentTaskStatus.Failed },
        { ...failed, status: SubagentTaskStatus.Completed },
        { ...failed, failure: { ...failure, code: "unknown" } },
        { ...failed, failure: { ...failure, message: "provider raw credential" } },
      ]) {
        expect(ChatEventSchema.safeParse({ ...identity, activity: invalid }).success).toBe(false);
      }
    }
  });
});
