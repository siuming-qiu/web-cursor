import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  AgentTaskRuntime,
  AgentTaskRuntimeError,
  AgentTaskRuntimeErrorCode,
  type AgentTaskExecutionContext,
} from "../../server/agentTaskRuntime";
import {
  SubagentMailboxDeliveryKind,
  SubagentProfileId,
  SubagentTaskEventType,
  SubagentTaskStatus,
  type SubagentTaskEvent,
  type TrustedSubagentCallerScope,
} from "../../types/subagent";

type TestRuntime = AgentTaskRuntime<string, string, string, string>;
type TestExecutionContext = AgentTaskExecutionContext<
  string,
  string,
  string
>;

const rootCaller: TrustedSubagentCallerScope = {
  taskId: "73ac6f75-e4a8-4f0a-891c-756f685f23db",
  rootTaskId: "73ac6f75-e4a8-4f0a-891c-756f685f23db",
  ownerId: "272330ae-d2cf-4b26-8d1c-1e94fac19890",
  projectId: "9d984c26-1daa-4755-ab20-af4e07bcfef6",
  depth: 0,
};

describe("AgentTaskRuntime admission", () => {
  it("inserts a UUID task synchronously, then executes it asynchronously", async () => {
    const execution = deferred<string>();
    const started: string[] = [];
    const runtime = createRuntime((context) => {
      started.push(context.task.taskId);
      return execution.promise;
    });

    const taskId = spawn(runtime, rootCaller, "inspect project");

    expect(taskId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(runtime.snapshot(rootCaller, taskId)).toMatchObject({
      taskId,
      parentTaskId: rootCaller.taskId,
      rootTaskId: rootCaller.rootTaskId,
      ownerId: rootCaller.ownerId,
      projectId: rootCaller.projectId,
      depth: 1,
      profileId: SubagentProfileId.Explorer,
      status: SubagentTaskStatus.Running,
    });
    expect(started).toEqual([]);

    await Promise.resolve();
    expect(started).toEqual([taskId]);

    execution.resolve("done");
    await expect(runtime.wait(rootCaller, taskId)).resolves.toEqual({
      taskId,
      status: SubagentTaskStatus.Completed,
      result: "done",
    });
  });

  it("rejects depth and active-child overflow without starting orphan tasks", async () => {
    const executions = new Map<string, Deferred<string>>();
    let executionCount = 0;
    const runtime = createRuntime((context) => {
      executionCount += 1;
      const execution = deferred<string>();
      executions.set(context.task.taskId, execution);
      return execution.promise;
    }, {
      maxDepth: 1,
      maxActiveChildrenPerParent: 1,
    });

    const firstTaskId = spawn(runtime, rootCaller, "first");
    expectRuntimeError(
      () => spawn(runtime, rootCaller, "over capacity"),
      AgentTaskRuntimeErrorCode.MaxActiveChildrenExceeded,
    );

    const firstScope = scopeFor(runtime, rootCaller, firstTaskId);
    expectRuntimeError(
      () => spawn(runtime, firstScope, "too deep"),
      AgentTaskRuntimeErrorCode.MaxDepthExceeded,
    );

    await Promise.resolve();
    expect(executionCount).toBe(1);

    executions.get(firstTaskId)?.resolve("first done");
    await runtime.wait(rootCaller, firstTaskId);

    const secondTaskId = spawn(runtime, rootCaller, "after settlement");
    await Promise.resolve();
    expect(executionCount).toBe(2);
    executions.get(secondTaskId)?.resolve("second done");
    await runtime.wait(rootCaller, secondTaskId);
  });

  it("rolls back a prepared spawn without execution and releases its reservation", async () => {
    let executionCount = 0;
    const runtime = createRuntime(() => {
      executionCount += 1;
      return "done";
    });
    const prepared = runtime.prepareSpawn({
      caller: rootCaller,
      profileId: SubagentProfileId.Explorer,
      input: "rolled back",
    });

    expectRuntimeError(
      () => runtime.snapshot(rootCaller, prepared.result),
      AgentTaskRuntimeErrorCode.NotFound,
    );
    expectRuntimeError(
      () => runtime.prepareSpawn({
        caller: rootCaller,
        profileId: SubagentProfileId.Explorer,
        input: "blocked by reservation",
      }),
      AgentTaskRuntimeErrorCode.MaxActiveChildrenExceeded,
    );

    prepared.rollback();
    prepared.rollback();
    prepared.commit();
    await Promise.resolve();
    expect(executionCount).toBe(0);

    const committed = runtime.prepareSpawn({
      caller: rootCaller,
      profileId: SubagentProfileId.Explorer,
      input: "admitted after rollback",
    });
    committed.commit();
    committed.commit();
    committed.rollback();
    await expect(runtime.wait(rootCaller, committed.result)).resolves.toEqual({
      taskId: committed.result,
      status: SubagentTaskStatus.Completed,
      result: "done",
    });
    expect(executionCount).toBe(1);
  });
});

describe("AgentTaskRuntime scope isolation", () => {
  it("replays only direct-child progress from the same owner, project, and root", async () => {
    const execution = deferred<string>();
    const runtime = createRuntime((context) => {
      context.publishProgress("reading src/App.tsx");
      return execution.promise;
    });
    const taskId = spawn(runtime, rootCaller, "inspect project");
    await Promise.resolve();

    const [child] = runtime.inspectChildren(rootCaller);
    expect(child).toMatchObject({
      snapshot: { taskId, status: SubagentTaskStatus.Running },
      input: "inspect project",
      progress: ["reading src/App.tsx"],
      result: null,
    });
    for (const other of [
      { ...rootCaller, ownerId: randomUUID() },
      { ...rootCaller, projectId: randomUUID() },
      { ...rootCaller, taskId: randomUUID(), rootTaskId: randomUUID() },
    ]) {
      if (other.taskId !== rootCaller.taskId) other.rootTaskId = other.taskId;
      expect(runtime.inspectChildren(other)).toEqual([]);
    }
    expect(runtime.inspectChildren(scopeFor(runtime, rootCaller, taskId))).toEqual([]);
    expect(runtime.inspectChildren(rootCaller)[0].progress).not.toBe(child.progress);

    execution.resolve("done");
    await runtime.wait(rootCaller, taskId);
    expect(runtime.inspectChildren(rootCaller)[0]).toMatchObject({
      snapshot: { status: SubagentTaskStatus.Completed },
      result: { status: SubagentTaskStatus.Completed, result: "done" },
    });
  });

  it("allows an unregistered root but requires every non-root scope field to match", () => {
    const runtime = createRuntime(() => new Promise<string>(() => {}), {
      maxDepth: 2,
      maxActiveChildrenPerParent: 2,
    });
    const taskId = spawn(runtime, rootCaller, "inspect");
    const childScope = scopeFor(runtime, rootCaller, taskId);

    expect(runtime.snapshot(childScope, taskId).taskId).toBe(taskId);

    const mismatchedScopes: TrustedSubagentCallerScope[] = [
      { ...childScope, taskId: randomUUID() },
      { ...childScope, rootTaskId: randomUUID() },
      { ...childScope, ownerId: randomUUID() },
      { ...childScope, projectId: randomUUID() },
      { ...childScope, depth: childScope.depth + 1 },
    ];
    const missingTargetError = captureRuntimeError(
      () => runtime.snapshot(rootCaller, randomUUID()),
    );

    for (const caller of mismatchedScopes) {
      const error = captureRuntimeError(
        () => runtime.snapshot(caller, taskId),
      );
      expect(error.code).toBe(AgentTaskRuntimeErrorCode.NotFound);
      expect(error.message).toBe(missingTargetError.message);
    }

    const unrelatedRoot = {
      ...rootCaller,
      taskId: randomUUID(),
      rootTaskId: "",
    };
    unrelatedRoot.rootTaskId = unrelatedRoot.taskId;
    const crossTreeError = captureRuntimeError(
      () => runtime.snapshot(unrelatedRoot, taskId),
    );
    expect(crossTreeError.code).toBe(AgentTaskRuntimeErrorCode.NotFound);
    expect(crossTreeError.message).toBe(missingTargetError.message);
  });
});

describe("AgentTaskRuntime waiting and interruption", () => {
  it("lets a waiter abort without aborting the child", async () => {
    const execution = deferred<string>();
    const childSignal: { current?: AbortSignal } = {};
    const runtime = createRuntime((context) => {
      childSignal.current = context.signal;
      return execution.promise;
    });
    const taskId = spawn(runtime, rootCaller, "inspect");
    await Promise.resolve();

    const waitController = new AbortController();
    const waiting = runtime.wait(rootCaller, taskId, waitController.signal);
    waitController.abort();

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(childSignal.current).toBeDefined();
    expect(childSignal.current?.aborted).toBe(false);
    expect(runtime.snapshot(rootCaller, taskId).status).toBe(
      SubagentTaskStatus.Running,
    );

    execution.resolve("done after observer left");
    await expect(runtime.wait(rootCaller, taskId)).resolves.toMatchObject({
      status: SubagentTaskStatus.Completed,
      result: "done after observer left",
    });
  });

  it("interrupts only the target and ignores its late completion", async () => {
    const executions = new Map<string, Deferred<string>>();
    const signals = new Map<string, AbortSignal>();
    const runtime = createRuntime((context) => {
      signals.set(context.task.taskId, context.signal);
      const execution = deferred<string>();
      executions.set(context.task.taskId, execution);
      return execution.promise;
    }, {
      maxDepth: 1,
      maxActiveChildrenPerParent: 2,
    });
    const firstTaskId = spawn(runtime, rootCaller, "first");
    const secondTaskId = spawn(runtime, rootCaller, "second");
    await Promise.resolve();

    const firstInterruption = runtime.interrupt(rootCaller, firstTaskId);
    expect(firstInterruption).toEqual({
      taskId: firstTaskId,
      status: SubagentTaskStatus.Interrupted,
    });
    expect(runtime.interrupt(rootCaller, firstTaskId)).toBe(firstInterruption);
    expect(signals.get(firstTaskId)?.aborted).toBe(true);
    expect(signals.get(secondTaskId)?.aborted).toBe(false);

    executions.get(firstTaskId)?.resolve("late result");
    await Promise.resolve();
    expect(runtime.result(rootCaller, firstTaskId)).toBe(firstInterruption);
    expect(runtime.snapshot(rootCaller, firstTaskId).status).toBe(
      SubagentTaskStatus.Interrupted,
    );

    executions.get(secondTaskId)?.resolve("second done");
    await expect(runtime.wait(rootCaller, secondTaskId)).resolves.toMatchObject({
      status: SubagentTaskStatus.Completed,
      result: "second done",
    });
  });

  it("stages interruption until commit and rollback leaves the target running", async () => {
    const executions = new Map<string, Deferred<string>>();
    const signals = new Map<string, AbortSignal>();
    const runtime = createRuntime((context) => {
      signals.set(context.task.taskId, context.signal);
      const execution = deferred<string>();
      executions.set(context.task.taskId, execution);
      return execution.promise;
    }, {
      maxDepth: 1,
      maxActiveChildrenPerParent: 2,
    });
    const firstTaskId = spawn(runtime, rootCaller, "first");
    const secondTaskId = spawn(runtime, rootCaller, "second");
    await Promise.resolve();

    const rolledBack = runtime.prepareInterrupt(rootCaller, firstTaskId);
    rolledBack.rollback();
    rolledBack.rollback();
    rolledBack.commit();
    expect(signals.get(firstTaskId)?.aborted).toBe(false);
    expect(runtime.snapshot(rootCaller, firstTaskId).status).toBe(
      SubagentTaskStatus.Running,
    );

    const committed = runtime.prepareInterrupt(rootCaller, firstTaskId);
    committed.commit();
    committed.commit();
    committed.rollback();
    expect(runtime.result(rootCaller, firstTaskId)).toBe(committed.result);
    expect(signals.get(firstTaskId)?.aborted).toBe(true);
    expect(signals.get(secondTaskId)?.aborted).toBe(false);

    executions.get(firstTaskId)?.resolve("ignored late result");
    executions.get(secondTaskId)?.resolve("second done");
    await expect(runtime.wait(rootCaller, secondTaskId)).resolves.toMatchObject({
      status: SubagentTaskStatus.Completed,
      result: "second done",
    });
  });

  it("settles rejected execution as failed exactly once", async () => {
    const failure = new Error("model failed");
    const runtime = createRuntime(() => {
      throw failure;
    });
    const taskId = spawn(runtime, rootCaller, "inspect");

    const result = await runtime.wait(rootCaller, taskId);
    expect(result).toEqual({
      taskId,
      status: SubagentTaskStatus.Failed,
      error: failure,
    });
    expect(runtime.result(rootCaller, taskId)).toBe(result);
    expect(runtime.interrupt(rootCaller, taskId)).toBe(result);
  });
});

describe("AgentTaskRuntime in-memory task channels", () => {
  it("delivers message and follow-up mailbox entries in order and rejects terminal restart", async () => {
    const execution = deferred<string>();
    const mailbox = {
      drain: undefined as TestExecutionContext["drainMailbox"] | undefined,
    };
    const runtime = createRuntime((context) => {
      mailbox.drain = context.drainMailbox;
      return execution.promise;
    });
    const taskId = spawn(runtime, rootCaller, "inspect");
    await Promise.resolve();

    runtime.sendMessage(rootCaller, taskId, "additional context");
    runtime.followupTask(rootCaller, taskId, "continue with this constraint");
    expect(mailbox.drain?.()).toEqual([
      {
        kind: SubagentMailboxDeliveryKind.Message,
        message: "additional context",
        triggerTurn: false,
      },
      {
        kind: SubagentMailboxDeliveryKind.FollowupTask,
        message: "continue with this constraint",
        triggerTurn: true,
      },
    ]);
    expect(mailbox.drain?.()).toEqual([]);

    execution.resolve("done");
    await runtime.wait(rootCaller, taskId);
    expectRuntimeError(
      () => runtime.sendMessage(rootCaller, taskId, "late"),
      AgentTaskRuntimeErrorCode.Conflict,
    );
    expectRuntimeError(
      () => runtime.followupTask(rootCaller, taskId, "restart"),
      AgentTaskRuntimeErrorCode.Conflict,
    );
  });

  it("keeps staged deliveries invisible until commit and discards rollback", async () => {
    const execution = deferred<string>();
    const executionState: { context?: TestExecutionContext } = {};
    const runtime = createRuntime((context) => {
      executionState.context = context;
      return execution.promise;
    });
    const taskId = spawn(runtime, rootCaller, "inspect");
    await Promise.resolve();

    const rolledBack = runtime.prepareSendMessage(
      rootCaller,
      taskId,
      "discard this",
    );
    expect(executionState.context?.drainMailbox()).toEqual([]);
    rolledBack.rollback();
    rolledBack.commit();
    expect(executionState.context?.drainMailbox()).toEqual([]);

    const committed = runtime.prepareFollowupTask(
      rootCaller,
      taskId,
      "deliver this",
    );
    expect(executionState.context?.drainMailbox()).toEqual([]);
    committed.commit();
    committed.commit();
    committed.rollback();
    expect(executionState.context?.drainMailbox()).toEqual([
      {
        kind: SubagentMailboxDeliveryKind.FollowupTask,
        message: "deliver this",
        triggerTurn: true,
      },
    ]);

    execution.resolve("done");
    await runtime.wait(rootCaller, taskId);
  });

  it("keeps transcript and lifecycle events scoped to the in-memory task", async () => {
    const execution = deferred<string>();
    const executionState: { context?: TestExecutionContext } = {};
    const runtime = createRuntime((context) => {
      executionState.context = context;
      return execution.promise;
    });
    const taskId = spawn(runtime, rootCaller, "inspect");
    const events: SubagentTaskEvent<string, string>[] = [];
    const unsubscribe = runtime.subscribe(
      rootCaller,
      taskId,
      (event) => events.push(event),
    );
    await Promise.resolve();

    executionState.context?.appendTranscript("read package.json");
    executionState.context?.publishProgress("searching");
    execution.resolve("done");
    await runtime.wait(rootCaller, taskId);

    expect(runtime.transcript(rootCaller, taskId)).toEqual([
      "read package.json",
    ]);
    expect(events.map((event) => event.type)).toEqual([
      SubagentTaskEventType.TranscriptAppended,
      SubagentTaskEventType.Progress,
      SubagentTaskEventType.StatusChanged,
    ]);

    unsubscribe();
  });

  it("commits a transcript batch before an interrupt observer can expose a partial round", async () => {
    const executionState: { context?: TestExecutionContext } = {};
    const runtime = createRuntime((context) => {
      executionState.context = context;
      return new Promise<string>((_resolve, reject) => {
        context.signal.addEventListener(
          "abort",
          () => reject(context.signal.reason),
          { once: true },
        );
      });
    });
    const taskId = spawn(runtime, rootCaller, "inspect");
    await Promise.resolve();

    let transcriptEvents = 0;
    runtime.subscribe(rootCaller, taskId, (event) => {
      if (event.type !== SubagentTaskEventType.TranscriptAppended) return;
      transcriptEvents += 1;
      if (transcriptEvents === 1) runtime.interrupt(rootCaller, taskId);
    });

    executionState.context?.appendTranscriptBatch([
      "assistant tool calls",
      "first tool result",
      "second tool result",
    ]);

    expect(runtime.transcript(rootCaller, taskId)).toEqual([
      "assistant tool calls",
      "first tool result",
      "second tool result",
    ]);
    await expect(runtime.wait(rootCaller, taskId)).resolves.toMatchObject({
      status: SubagentTaskStatus.Interrupted,
    });
  });
});

describe("AgentTaskRuntime completion boundary", () => {
  it("waits for a staged delivery and returns it after commit", async () => {
    const enterCompletion = deferred<void>();
    const boundaryEntered = deferred<void>();
    let boundaryResolved = false;
    const runtime = createRuntime(async (context) => {
      await enterCompletion.promise;
      boundaryEntered.resolve();
      const deliveries = await context.drainMailboxAtCompletion();
      boundaryResolved = true;
      return deliveries.map((delivery) => delivery.message).join(",");
    });
    const taskId = spawn(runtime, rootCaller, "inspect");
    await Promise.resolve();
    const prepared = runtime.prepareSendMessage(
      rootCaller,
      taskId,
      "transaction committed",
    );

    enterCompletion.resolve();
    await boundaryEntered.promise;
    await Promise.resolve();
    expect(boundaryResolved).toBe(false);
    expect(runtime.snapshot(rootCaller, taskId).status).toBe(
      SubagentTaskStatus.Running,
    );

    prepared.commit();
    await expect(runtime.wait(rootCaller, taskId)).resolves.toEqual({
      taskId,
      status: SubagentTaskStatus.Completed,
      result: "transaction committed",
    });
    expect(boundaryResolved).toBe(true);
  });

  it("reopens after nonempty drains and seals only after an empty drain", async () => {
    const enterFirstDrain = deferred<void>();
    const enterSecondDrain = deferred<void>();
    const enterEmptyDrain = deferred<void>();
    const firstDrainFinished = deferred<void>();
    const secondDrainFinished = deferred<void>();
    const emptyDrainFinished = deferred<void>();
    const finishExecution = deferred<void>();
    const drainedMessages: string[][] = [];
    const runtime = createRuntime(async (context) => {
      await enterFirstDrain.promise;
      drainedMessages.push(
        (await context.drainMailboxAtCompletion()).map(
          (delivery) => delivery.message,
        ),
      );
      firstDrainFinished.resolve();

      await enterSecondDrain.promise;
      drainedMessages.push(
        (await context.drainMailboxAtCompletion()).map(
          (delivery) => delivery.message,
        ),
      );
      secondDrainFinished.resolve();

      await enterEmptyDrain.promise;
      drainedMessages.push(
        (await context.drainMailboxAtCompletion()).map(
          (delivery) => delivery.message,
        ),
      );
      emptyDrainFinished.resolve();
      await finishExecution.promise;
      return drainedMessages.flat().join(",");
    });
    const taskId = spawn(runtime, rootCaller, "inspect");
    await Promise.resolve();

    const firstDelivery = runtime.prepareSendMessage(
      rootCaller,
      taskId,
      "first round",
    );
    firstDelivery.commit();
    enterFirstDrain.resolve();
    await firstDrainFinished.promise;
    expect(drainedMessages).toEqual([["first round"]]);

    const secondDelivery = runtime.prepareFollowupTask(
      rootCaller,
      taskId,
      "second round",
    );
    secondDelivery.commit();
    enterSecondDrain.resolve();
    await secondDrainFinished.promise;
    expect(drainedMessages).toEqual([
      ["first round"],
      ["second round"],
    ]);

    const admissionProbe = runtime.prepareSendMessage(
      rootCaller,
      taskId,
      "rollback probe",
    );
    admissionProbe.rollback();
    enterEmptyDrain.resolve();
    await emptyDrainFinished.promise;
    expect(drainedMessages).toEqual([
      ["first round"],
      ["second round"],
      [],
    ]);
    expectRuntimeError(
      () => runtime.prepareSendMessage(rootCaller, taskId, "too late"),
      AgentTaskRuntimeErrorCode.Conflict,
    );

    finishExecution.resolve();
    await expect(runtime.wait(rootCaller, taskId)).resolves.toMatchObject({
      status: SubagentTaskStatus.Completed,
      result: "first round,second round",
    });
  });

  it("atomically seals delivery admission but still permits interruption", async () => {
    const finishExecution = deferred<void>();
    const completionSealed = deferred<void>();
    const executionState: { signal?: AbortSignal } = {};
    let completionDeliveryCount: number | undefined;
    const runtime = createRuntime(async (context) => {
      executionState.signal = context.signal;
      const deliveries = await context.drainMailboxAtCompletion();
      completionDeliveryCount = deliveries.length;
      completionSealed.resolve();
      await finishExecution.promise;
      return "done";
    });
    const taskId = spawn(runtime, rootCaller, "inspect");
    await completionSealed.promise;

    expect(runtime.snapshot(rootCaller, taskId).status).toBe(
      SubagentTaskStatus.Running,
    );
    expect(completionDeliveryCount).toBe(0);
    expectRuntimeError(
      () => runtime.prepareSendMessage(rootCaller, taskId, "too late"),
      AgentTaskRuntimeErrorCode.Conflict,
    );
    expectRuntimeError(
      () => runtime.prepareFollowupTask(rootCaller, taskId, "restart"),
      AgentTaskRuntimeErrorCode.Conflict,
    );

    const interruption = runtime.prepareInterrupt(rootCaller, taskId);
    interruption.commit();
    expect(executionState.signal?.aborted).toBe(true);
    await expect(runtime.wait(rootCaller, taskId)).resolves.toBe(
      interruption.result,
    );

    finishExecution.resolve();
    await Promise.resolve();
  });

  it("rejects the completion drain when a staged interrupt commits", async () => {
    const enterCompletion = deferred<void>();
    const boundaryEntered = deferred<void>();
    const boundaryRejection = deferred<unknown>();
    const runtime = createRuntime(async (context) => {
      await enterCompletion.promise;
      boundaryEntered.resolve();
      try {
        await context.drainMailboxAtCompletion();
        return "unexpected completion";
      } catch (error) {
        boundaryRejection.resolve(error);
        throw error;
      }
    });
    const taskId = spawn(runtime, rootCaller, "inspect");
    await Promise.resolve();
    const prepared = runtime.prepareInterrupt(rootCaller, taskId);

    enterCompletion.resolve();
    await boundaryEntered.promise;
    prepared.commit();

    await expect(boundaryRejection.promise).resolves.toMatchObject({
      name: "AbortError",
    });
    await expect(runtime.wait(rootCaller, taskId)).resolves.toBe(
      prepared.result,
    );
  });

  it("delays terminal settlement while a staged action is undecided", async () => {
    const execution = deferred<string>();
    const runtime = createRuntime(() => execution.promise);
    const taskId = spawn(runtime, rootCaller, "inspect");
    await Promise.resolve();
    const prepared = runtime.prepareSendMessage(
      rootCaller,
      taskId,
      "pending transaction",
    );

    execution.resolve("done");
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.result(rootCaller, taskId)).toBeNull();
    expect(runtime.snapshot(rootCaller, taskId).status).toBe(
      SubagentTaskStatus.Running,
    );

    prepared.rollback();
    await expect(runtime.wait(rootCaller, taskId)).resolves.toMatchObject({
      status: SubagentTaskStatus.Completed,
      result: "done",
    });
  });
});

function createRuntime(
  executeTask: (context: TestExecutionContext) => Promise<string> | string,
  limits: Readonly<{
    maxDepth: number;
    maxActiveChildrenPerParent: number;
  }> = {
    maxDepth: 1,
    maxActiveChildrenPerParent: 1,
  },
): TestRuntime {
  return new AgentTaskRuntime({
    ...limits,
    executeTask,
  });
}

function spawn(
  runtime: TestRuntime,
  caller: TrustedSubagentCallerScope,
  input: string,
): string {
  return runtime.spawn({
    caller,
    profileId: SubagentProfileId.Explorer,
    input,
  });
}

function scopeFor(
  runtime: TestRuntime,
  caller: TrustedSubagentCallerScope,
  taskId: string,
): TrustedSubagentCallerScope {
  const snapshot = runtime.snapshot(caller, taskId);
  return {
    taskId: snapshot.taskId,
    rootTaskId: snapshot.rootTaskId,
    ownerId: snapshot.ownerId,
    projectId: snapshot.projectId,
    depth: snapshot.depth,
  };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}>;

function expectRuntimeError(
  action: () => unknown,
  code: AgentTaskRuntimeErrorCodeValue,
): void {
  expect(captureRuntimeError(action).code).toBe(code);
}

type AgentTaskRuntimeErrorCodeValue =
  typeof AgentTaskRuntimeErrorCode[keyof typeof AgentTaskRuntimeErrorCode];

function captureRuntimeError(action: () => unknown): AgentTaskRuntimeError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AgentTaskRuntimeError);
    return error as AgentTaskRuntimeError;
  }
  throw new Error("Expected AgentTaskRuntimeError");
}
