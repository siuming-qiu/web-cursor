/**
 * [INPUT]: 可信 caller scope、已验证 profile、任务输入和显式 Runtime 限额
 * [OUTPUT]: 进程内 Child task 的 staged spawn/control、wait、transcript 与 event API
 * [POS]: 通用 Sub-agent 的进程内任务注册表；不依赖 HTTP、数据库或 AgentRun
 * [PROTOCOL]: prepare 只保留资源，commit 才生效；completion seal 与 final drain 原子完成
 */
import "server-only";
import { randomUUID } from "node:crypto";
import {
  SubagentMailboxDeliveryKind,
  SubagentTaskEventType,
  SubagentTaskStatus,
  type SubagentMailboxDelivery,
  type SubagentProfileId,
  type SubagentTaskEvent,
  type SubagentTaskResultSnapshot,
  type SubagentTaskSnapshot,
  type TrustedSubagentCallerScope,
} from "@/types/subagent";

export const AgentTaskRuntimeErrorCode = {
  NotFound: "SUBAGENT_TASK_NOT_FOUND",
  Conflict: "SUBAGENT_TASK_CONFLICT",
  MaxDepthExceeded: "SUBAGENT_MAX_DEPTH_EXCEEDED",
  MaxActiveChildrenExceeded: "SUBAGENT_MAX_ACTIVE_CHILDREN_EXCEEDED",
  InvalidConfiguration: "SUBAGENT_INVALID_CONFIGURATION",
} as const;

export type AgentTaskRuntimeErrorCode =
  typeof AgentTaskRuntimeErrorCode[keyof typeof AgentTaskRuntimeErrorCode];

export class AgentTaskRuntimeError extends Error {
  constructor(
    readonly code: AgentTaskRuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentTaskRuntimeError";
  }
}

export type SpawnAgentTaskRequest<TTaskInput> = Readonly<{
  caller: TrustedSubagentCallerScope;
  profileId: SubagentProfileId;
  input: TTaskInput;
}>;

export type PreparedAgentTaskAction<TResult> = Readonly<{
  result: TResult;
  commit(): void;
  rollback(): void;
}>;

export type AgentTaskExecutionContext<
  TTaskInput,
  TTranscriptEntry,
  TProgressEvent,
> = Readonly<{
  task: SubagentTaskSnapshot;
  input: TTaskInput;
  signal: AbortSignal;
  appendTranscript(entry: TTranscriptEntry): void;
  appendTranscriptBatch(entries: readonly TTranscriptEntry[]): void;
  drainMailbox(): readonly SubagentMailboxDelivery[];
  drainMailboxAtCompletion(): Promise<readonly SubagentMailboxDelivery[]>;
  publishProgress(progress: TProgressEvent): void;
}>;

export type AgentTaskExecutor<
  TTaskInput,
  TResult,
  TTranscriptEntry,
  TProgressEvent,
> = (
  context: AgentTaskExecutionContext<
    TTaskInput,
    TTranscriptEntry,
    TProgressEvent
  >,
) => Promise<TResult> | TResult;

export type AgentTaskRuntimeOptions<
  TTaskInput,
  TResult,
  TTranscriptEntry,
  TProgressEvent,
> = Readonly<{
  maxDepth: number;
  maxActiveChildrenPerParent: number;
  executeTask: AgentTaskExecutor<
    TTaskInput,
    TResult,
    TTranscriptEntry,
    TProgressEvent
  >;
}>;

export type AgentTaskEventListener<TTranscriptEntry, TProgressEvent> = (
  event: SubagentTaskEvent<TTranscriptEntry, TProgressEvent>,
) => void;

type TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent> = {
  snapshot: SubagentTaskSnapshot;
  input: TTaskInput;
  progress: TProgressEvent[];
  controller: AbortController;
  transcript: TTranscriptEntry[];
  mailbox: SubagentMailboxDelivery[];
  mailboxCompletionSealed: boolean;
  pendingStagedActions: Set<Promise<void>>;
  subscribers: Set<AgentTaskEventListener<TTranscriptEntry, TProgressEvent>>;
  terminalResult: SubagentTaskResultSnapshot<TResult> | null;
  settlement: Promise<SubagentTaskResultSnapshot<TResult>>;
  resolveSettlement: (
    result: SubagentTaskResultSnapshot<TResult>,
  ) => void;
};

const TASK_NOT_FOUND_MESSAGE = "Subagent task was not found";

export class AgentTaskRuntime<
  TTaskInput,
  TResult,
  TTranscriptEntry,
  TProgressEvent = never,
> {
  private readonly maxDepth: number;
  private readonly maxActiveChildrenPerParent: number;
  private readonly executeTask: AgentTaskExecutor<
    TTaskInput,
    TResult,
    TTranscriptEntry,
    TProgressEvent
  >;
  private readonly tasks = new Map<
    string,
    TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>
  >();
  private readonly spawnReservations = new Map<string, string>();

  constructor(options: AgentTaskRuntimeOptions<
    TTaskInput,
    TResult,
    TTranscriptEntry,
    TProgressEvent
  >) {
    assertRuntimeLimit("maxDepth", options.maxDepth, 0);
    assertRuntimeLimit(
      "maxActiveChildrenPerParent",
      options.maxActiveChildrenPerParent,
      1,
    );
    if (typeof options.executeTask !== "function") {
      throw new AgentTaskRuntimeError(
        AgentTaskRuntimeErrorCode.InvalidConfiguration,
        "executeTask must be a function",
      );
    }

    this.maxDepth = options.maxDepth;
    this.maxActiveChildrenPerParent = options.maxActiveChildrenPerParent;
    this.executeTask = options.executeTask;
  }

  spawn(request: SpawnAgentTaskRequest<TTaskInput>): string {
    const action = this.prepareSpawn(request);
    action.commit();
    return action.result;
  }

  prepareSpawn(
    request: SpawnAgentTaskRequest<TTaskInput>,
  ): PreparedAgentTaskAction<string> {
    const callerRecord = this.resolveCaller(request.caller);
    if (callerRecord) this.assertRunning(callerRecord);

    const childDepth = request.caller.depth + 1;
    if (childDepth > this.maxDepth) {
      throw new AgentTaskRuntimeError(
        AgentTaskRuntimeErrorCode.MaxDepthExceeded,
        `Subagent task depth ${childDepth} exceeds maxDepth ${this.maxDepth}`,
      );
    }
    if (
      this.activeChildCount(request.caller.taskId)
      >= this.maxActiveChildrenPerParent
    ) {
      throw new AgentTaskRuntimeError(
        AgentTaskRuntimeErrorCode.MaxActiveChildrenExceeded,
        "Parent has reached maxActiveChildrenPerParent",
      );
    }

    const taskId = this.nextTaskId();
    const snapshot: SubagentTaskSnapshot = {
      taskId,
      parentTaskId: request.caller.taskId,
      rootTaskId: request.caller.rootTaskId,
      ownerId: request.caller.ownerId,
      projectId: request.caller.projectId,
      depth: childDepth,
      profileId: request.profileId,
      status: SubagentTaskStatus.Running,
    };
    this.spawnReservations.set(taskId, request.caller.taskId);

    return createPreparedAgentTaskAction(
      taskId,
      () => {
        this.spawnReservations.delete(taskId);
        const record = this.createRecord(snapshot, request.input);
        this.tasks.set(taskId, record);
        queueMicrotask(() => {
          void this.runTask(record);
        });
      },
      () => {
        this.spawnReservations.delete(taskId);
      },
    );
  }

  snapshot(
    caller: TrustedSubagentCallerScope,
    taskId: string,
  ): SubagentTaskSnapshot {
    return { ...this.resolveTarget(caller, taskId).snapshot };
  }

  inspectChildren(caller: TrustedSubagentCallerScope): ReadonlyArray<{
    snapshot: SubagentTaskSnapshot;
    input: TTaskInput;
    progress: readonly TProgressEvent[];
    result: SubagentTaskResultSnapshot<TResult> | null;
  }> {
    this.resolveCaller(caller);
    return [...this.tasks.values()]
      .filter((record) => record.snapshot.parentTaskId === caller.taskId
        && sameTaskTree(record.snapshot, caller))
      .map((record) => ({
        snapshot: { ...record.snapshot },
        input: record.input,
        progress: [...record.progress],
        result: record.terminalResult,
      }));
  }

  result(
    caller: TrustedSubagentCallerScope,
    taskId: string,
  ): SubagentTaskResultSnapshot<TResult> | null {
    return this.resolveTarget(caller, taskId).terminalResult;
  }

  transcript(
    caller: TrustedSubagentCallerScope,
    taskId: string,
  ): readonly TTranscriptEntry[] {
    return [...this.resolveTarget(caller, taskId).transcript];
  }

  wait(
    caller: TrustedSubagentCallerScope,
    taskId: string,
    signal?: AbortSignal,
  ): Promise<SubagentTaskResultSnapshot<TResult>> {
    const record = this.resolveTarget(caller, taskId);
    if (record.terminalResult) return Promise.resolve(record.terminalResult);
    if (!signal) return record.settlement;
    if (signal.aborted) return Promise.reject(abortReason(signal));

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        reject(abortReason(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void record.settlement.then((settlement) => {
        signal.removeEventListener("abort", onAbort);
        resolve(settlement);
      });
    });
  }

  interrupt(
    caller: TrustedSubagentCallerScope,
    taskId: string,
  ): SubagentTaskResultSnapshot<TResult> {
    const action = this.prepareInterrupt(caller, taskId);
    action.commit();
    return action.result;
  }

  prepareInterrupt(
    caller: TrustedSubagentCallerScope,
    taskId: string,
  ): PreparedAgentTaskAction<SubagentTaskResultSnapshot<TResult>> {
    const record = this.resolveTarget(caller, taskId);
    if (record.terminalResult) {
      return createPreparedAgentTaskAction(
        record.terminalResult,
        () => {},
        () => {},
      );
    }

    const result = {
      taskId,
      status: SubagentTaskStatus.Interrupted,
    } as const;
    const release = this.registerStagedAction(record);
    return createPreparedAgentTaskAction(
      result,
      () => {
        try {
          this.settle(record, result);
          record.controller.abort();
        } finally {
          release();
        }
      },
      release,
    );
  }

  sendMessage(
    caller: TrustedSubagentCallerScope,
    taskId: string,
    message: string,
  ): SubagentMailboxDelivery {
    const action = this.prepareSendMessage(caller, taskId, message);
    action.commit();
    return action.result;
  }

  prepareSendMessage(
    caller: TrustedSubagentCallerScope,
    taskId: string,
    message: string,
  ): PreparedAgentTaskAction<SubagentMailboxDelivery> {
    return this.prepareDelivery(caller, taskId, {
      kind: SubagentMailboxDeliveryKind.Message,
      message,
      triggerTurn: false,
    });
  }

  followupTask(
    caller: TrustedSubagentCallerScope,
    taskId: string,
    message: string,
  ): SubagentMailboxDelivery {
    const action = this.prepareFollowupTask(caller, taskId, message);
    action.commit();
    return action.result;
  }

  prepareFollowupTask(
    caller: TrustedSubagentCallerScope,
    taskId: string,
    message: string,
  ): PreparedAgentTaskAction<SubagentMailboxDelivery> {
    return this.prepareDelivery(caller, taskId, {
      kind: SubagentMailboxDeliveryKind.FollowupTask,
      message,
      triggerTurn: true,
    });
  }

  drainMailbox(
    caller: TrustedSubagentCallerScope,
  ): readonly SubagentMailboxDelivery[] {
    const record = this.resolveCaller(caller);
    if (!record) this.notFound();
    return this.drainRecordMailbox(record);
  }

  subscribe(
    caller: TrustedSubagentCallerScope,
    taskId: string,
    listener: AgentTaskEventListener<TTranscriptEntry, TProgressEvent>,
  ): () => void {
    const record = this.resolveTarget(caller, taskId);
    record.subscribers.add(listener);
    return () => {
      record.subscribers.delete(listener);
    };
  }

  private async runTask(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
  ): Promise<void> {
    if (record.snapshot.status !== SubagentTaskStatus.Running) return;

    let terminalResult: SubagentTaskResultSnapshot<TResult>;
    try {
      const result = await this.executeTask({
        task: { ...record.snapshot },
        input: record.input,
        signal: record.controller.signal,
        appendTranscript: (entry) => {
          this.appendTranscript(record, entry);
        },
        appendTranscriptBatch: (entries) => {
          this.appendTranscriptBatch(record, entries);
        },
        drainMailbox: () => this.drainRecordMailbox(record),
        drainMailboxAtCompletion: () =>
          this.drainRecordMailboxAtCompletion(record),
        publishProgress: (progress) => {
          this.publishProgress(record, progress);
        },
      });
      terminalResult = {
        taskId: record.snapshot.taskId,
        status: SubagentTaskStatus.Completed,
        result,
      };
    } catch (error) {
      terminalResult = {
        taskId: record.snapshot.taskId,
        status: SubagentTaskStatus.Failed,
        error,
      };
    }

    await this.runAfterStagedActions(record, () => {
      this.settle(record, terminalResult);
    });
  }

  private createRecord(
    snapshot: SubagentTaskSnapshot,
    input: TTaskInput,
  ): TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent> {
    let resolveSettlement!: (
      result: SubagentTaskResultSnapshot<TResult>,
    ) => void;
    const settlement = new Promise<SubagentTaskResultSnapshot<TResult>>(
      (resolve) => {
        resolveSettlement = resolve;
      },
    );

    return {
      snapshot,
      input,
      progress: [],
      controller: new AbortController(),
      transcript: [],
      mailbox: [],
      mailboxCompletionSealed: false,
      pendingStagedActions: new Set(),
      subscribers: new Set(),
      terminalResult: null,
      settlement,
      resolveSettlement,
    };
  }

  private settle(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
    result: SubagentTaskResultSnapshot<TResult>,
  ): boolean {
    if (record.snapshot.status !== SubagentTaskStatus.Running) return false;

    record.snapshot = {
      ...record.snapshot,
      status: result.status,
    };
    record.terminalResult = result;
    record.resolveSettlement(result);
    this.emit(record, {
      type: SubagentTaskEventType.StatusChanged,
      snapshot: { ...record.snapshot },
    });
    return true;
  }

  private prepareDelivery(
    caller: TrustedSubagentCallerScope,
    taskId: string,
    delivery: SubagentMailboxDelivery,
  ): PreparedAgentTaskAction<SubagentMailboxDelivery> {
    const record = this.resolveTarget(caller, taskId);
    this.assertRunning(record);
    if (record.mailboxCompletionSealed) {
      throw new AgentTaskRuntimeError(
        AgentTaskRuntimeErrorCode.Conflict,
        "Subagent task no longer accepts mailbox deliveries",
      );
    }
    const release = this.registerStagedAction(record);
    return createPreparedAgentTaskAction(
      delivery,
      () => {
        try {
          this.enqueueRecord(record, delivery);
        } finally {
          release();
        }
      },
      release,
    );
  }

  private enqueueRecord(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
    delivery: SubagentMailboxDelivery,
  ): void {
    record.mailbox.push(delivery);
    this.emit(record, {
      type: SubagentTaskEventType.MailboxEnqueued,
      snapshot: { ...record.snapshot },
      delivery,
    });
  }

  private drainRecordMailbox(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
  ): readonly SubagentMailboxDelivery[] {
    this.assertRunning(record);
    if (record.mailbox.length === 0) return [];

    const deliveries = record.mailbox.splice(0, record.mailbox.length);
    this.emit(record, {
      type: SubagentTaskEventType.MailboxDrained,
      snapshot: { ...record.snapshot },
      deliveries,
    });
    return deliveries;
  }

  private async drainRecordMailboxAtCompletion(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
  ): Promise<readonly SubagentMailboxDelivery[]> {
    return this.runAfterStagedActions(
      record,
      () => {
        this.assertRunning(record);
        const shouldSeal = record.mailbox.length === 0;
        record.mailboxCompletionSealed = shouldSeal;
        const deliveries = shouldSeal ? [] : this.drainRecordMailbox(record);
        if (record.controller.signal.aborted) {
          throw abortReason(record.controller.signal);
        }
        return deliveries;
      },
      record.controller.signal,
    );
  }

  private registerStagedAction(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
  ): () => void {
    let resolveSettlement!: () => void;
    const settlement = new Promise<void>((resolve) => {
      resolveSettlement = resolve;
    });
    record.pendingStagedActions.add(settlement);
    let released = false;

    return () => {
      if (released) return;
      released = true;
      record.pendingStagedActions.delete(settlement);
      resolveSettlement();
    };
  }

  private async runAfterStagedActions<TValue>(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
    action: () => TValue,
    signal?: AbortSignal,
  ): Promise<TValue> {
    while (record.pendingStagedActions.size > 0) {
      const settlement = Promise.all(record.pendingStagedActions).then(
        () => undefined,
      );
      await (signal
        ? waitForSettlementOrAbort(settlement, signal)
        : settlement);
    }
    if (signal?.aborted) throw abortReason(signal);
    return action();
  }

  private appendTranscript(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
    entry: TTranscriptEntry,
  ): void {
    this.appendTranscriptBatch(record, [entry]);
  }

  private appendTranscriptBatch(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
    entries: readonly TTranscriptEntry[],
  ): void {
    this.assertRunning(record);
    if (entries.length === 0) return;

    record.transcript.push(...entries);
    const snapshot = { ...record.snapshot };
    for (const entry of entries) {
      this.emit(record, {
        type: SubagentTaskEventType.TranscriptAppended,
        snapshot,
        entry,
      });
    }
  }

  private publishProgress(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
    progress: TProgressEvent,
  ): void {
    this.assertRunning(record);
    record.progress.push(progress);
    this.emit(record, {
      type: SubagentTaskEventType.Progress,
      snapshot: { ...record.snapshot },
      progress,
    });
  }

  private emit(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
    event: SubagentTaskEvent<TTranscriptEntry, TProgressEvent>,
  ): void {
    for (const listener of record.subscribers) {
      try {
        listener(event);
      } catch {
        // Observers must not be able to corrupt task settlement.
      }
    }
  }

  private resolveCaller(
    caller: TrustedSubagentCallerScope,
  ): TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent> | null {
    if (
      caller.taskId === caller.rootTaskId
      && caller.depth === 0
    ) {
      return null;
    }

    const record = this.tasks.get(caller.taskId);
    if (!record || !scopeMatches(record.snapshot, caller)) this.notFound();
    return record;
  }

  private resolveTarget(
    caller: TrustedSubagentCallerScope,
    taskId: string,
  ): TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent> {
    this.resolveCaller(caller);
    const record = this.tasks.get(taskId);
    if (!record || !sameTaskTree(record.snapshot, caller)) this.notFound();
    return record;
  }

  private assertRunning(
    record: TaskRecord<TTaskInput, TResult, TTranscriptEntry, TProgressEvent>,
  ): void {
    if (record.snapshot.status !== SubagentTaskStatus.Running) {
      throw new AgentTaskRuntimeError(
        AgentTaskRuntimeErrorCode.Conflict,
        "Subagent task is already terminal",
      );
    }
  }

  private activeChildCount(parentTaskId: string): number {
    let count = 0;
    for (const record of this.tasks.values()) {
      if (
        record.snapshot.parentTaskId === parentTaskId
        && record.snapshot.status === SubagentTaskStatus.Running
      ) {
        count += 1;
      }
    }
    for (const reservationParentTaskId of this.spawnReservations.values()) {
      if (reservationParentTaskId === parentTaskId) count += 1;
    }
    return count;
  }

  private nextTaskId(): string {
    let taskId = randomUUID();
    while (this.tasks.has(taskId) || this.spawnReservations.has(taskId)) {
      taskId = randomUUID();
    }
    return taskId;
  }

  private notFound(): never {
    throw new AgentTaskRuntimeError(
      AgentTaskRuntimeErrorCode.NotFound,
      TASK_NOT_FOUND_MESSAGE,
    );
  }
}

function assertRuntimeLimit(
  name: "maxDepth" | "maxActiveChildrenPerParent",
  value: number,
  minimum: number,
): void {
  if (Number.isInteger(value) && value >= minimum) return;
  throw new AgentTaskRuntimeError(
    AgentTaskRuntimeErrorCode.InvalidConfiguration,
    `${name} must be an integer greater than or equal to ${minimum}`,
  );
}

function scopeMatches(
  snapshot: SubagentTaskSnapshot,
  caller: TrustedSubagentCallerScope,
): boolean {
  return snapshot.taskId === caller.taskId
    && snapshot.rootTaskId === caller.rootTaskId
    && snapshot.ownerId === caller.ownerId
    && snapshot.projectId === caller.projectId
    && snapshot.depth === caller.depth;
}

function sameTaskTree(
  snapshot: SubagentTaskSnapshot,
  caller: TrustedSubagentCallerScope,
): boolean {
  return snapshot.rootTaskId === caller.rootTaskId
    && snapshot.ownerId === caller.ownerId
    && snapshot.projectId === caller.projectId;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Wait was aborted", "AbortError");
}

function createPreparedAgentTaskAction<TResult>(
  result: TResult,
  onCommit: () => void,
  onRollback: () => void,
): PreparedAgentTaskAction<TResult> {
  let finalized = false;
  const finalize = (action: () => void) => {
    if (finalized) return;
    finalized = true;
    action();
  };

  return {
    result,
    commit: () => finalize(onCommit),
    rollback: () => finalize(onRollback),
  };
}

function waitForSettlementOrAbort(
  settlement: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (callback: () => void) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      finish(() => reject(abortReason(signal)));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void settlement.then(() => {
      finish(resolve);
    });
  });
}
