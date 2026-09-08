"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Square,
  WifiOff,
} from "lucide-react";
import {
  SubagentActivityViewKind,
  SubagentObservationStatus,
  type SubagentActivityView,
  type SubagentRunView,
} from "@/lib/types";
import {
  SubagentFailureCode,
  SubagentProfileId,
  SubagentTaskStatus,
  SubagentToolStatus,
  type SubagentFailure,
  type SubagentProfileId as SubagentProfileIdValue,
  type SubagentTaskStatus as SubagentTaskStatusValue,
} from "@/types/subagent";
import { ToolName } from "@/types/tool";

const MAX_VISIBLE_ACTIVITIES = 6;

const ExpansionPreference = {
  Auto: "auto",
  Expanded: "expanded",
  Collapsed: "collapsed",
} as const;

type ExpansionPreference =
  typeof ExpansionPreference[keyof typeof ExpansionPreference];

function statusTone(status: SubagentTaskStatusValue): string {
  if (status === SubagentTaskStatus.Completed) return "text-green";
  if (status === SubagentTaskStatus.Failed) return "text-red";
  if (status === SubagentTaskStatus.Interrupted) return "text-muted";
  return "text-yellow";
}

function StatusIcon({ status, disconnected }: {
  status: SubagentTaskStatusValue;
  disconnected: boolean;
}) {
  const className = statusTone(status);
  if (status === SubagentTaskStatus.Completed) {
    return <CheckCircle2 size={14} className={className} strokeWidth={2} />;
  }
  if (status === SubagentTaskStatus.Failed) {
    return <AlertCircle size={14} className={className} strokeWidth={2} />;
  }
  if (status === SubagentTaskStatus.Interrupted) {
    return <Square size={12} className={className} strokeWidth={2} />;
  }
  if (disconnected) {
    return <WifiOff size={14} className="text-muted" strokeWidth={2} />;
  }
  return <Loader2 size={14} className={className + " animate-spin"} strokeWidth={2} />;
}

function activityLabel(
  activity: SubagentActivityView,
  t: ReturnType<typeof useTranslations<"Chat">>,
): string {
  if (activity.kind === SubagentActivityViewKind.Started) {
    return t("subagentActivityStarted");
  }
  if (activity.kind === SubagentActivityViewKind.ModelOutput) {
    return t("subagentActivityModelOutput");
  }
  if (activity.kind === SubagentActivityViewKind.ModelStarted) {
    return t("subagentActivityModelStarted");
  }
  if (activity.toolName === ToolName.ListFiles) {
    return t("subagentActivityListFiles");
  }
  if (activity.toolName === ToolName.SearchText) {
    return t("subagentActivitySearchText");
  }
  if (activity.toolName === ToolName.ReadFile) {
    return t("subagentActivityReadFile");
  }
  return activity.toolName;
}

function failureLabel(
  failure: SubagentFailure,
  t: ReturnType<typeof useTranslations<"Chat">>,
): string {
  const labels: Record<SubagentFailure["code"], string> = {
    [SubagentFailureCode.MaxModelRounds]: t("subagentFailureMaxModelRounds"),
    [SubagentFailureCode.ModelRequestFailed]: t("subagentFailureModelRequestFailed"),
    [SubagentFailureCode.ExecutionFailed]: t("subagentFailureExecutionFailed"),
  };
  return labels[failure.code];
}

export default function SubagentActivityCard({ run }: { run: SubagentRunView }) {
  const t = useTranslations("Chat");
  const contentId = useId();
  const activityListId = useId();
  const [preference, setPreference] = useState<ExpansionPreference>(
    ExpansionPreference.Auto,
  );
  const [showAll, setShowAll] = useState(false);
  const running = run.status === SubagentTaskStatus.Running;
  const disconnected = running && run.observation.status === SubagentObservationStatus.Disconnected;
  const expanded = preference === ExpansionPreference.Expanded
    || (preference === ExpansionPreference.Auto && (running || run.status === SubagentTaskStatus.Failed));
  const hiddenActivityCount = Math.max(
    0,
    run.activities.length - MAX_VISIBLE_ACTIVITIES,
  );
  const activities = showAll ? run.activities : run.activities.slice(-MAX_VISIBLE_ACTIVITIES);
  const profileLabels: Record<SubagentProfileIdValue, string> = {
    [SubagentProfileId.Explorer]: t("subagentProfileExplorer"),
  };
  const statusLabels: Record<SubagentTaskStatusValue, string> = {
    [SubagentTaskStatus.Running]: t("subagentStatusRunning"),
    [SubagentTaskStatus.Completed]: t("subagentStatusCompleted"),
    [SubagentTaskStatus.Failed]: t("subagentStatusFailed"),
    [SubagentTaskStatus.Interrupted]: t("subagentStatusInterrupted"),
  };

  return (
    <section
      className="mt-2 w-full min-w-0 overflow-hidden rounded-[10px] border border-border bg-codebg"
      data-subagent-activity-card={run.agentId}
    >
      <button
        type="button"
        className="block w-full min-w-0 px-3 py-2.5 text-left outline-none transition-colors hover:bg-panel focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => {
          setPreference(
            expanded
              ? ExpansionPreference.Collapsed
              : ExpansionPreference.Expanded,
          );
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Bot size={14} className="flex-none text-accent" strokeWidth={1.9} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">
            {profileLabels[run.profileId]}
          </span>
          <span
            className={"inline-flex flex-none items-center gap-1.5 text-[11.5px] " + statusTone(run.status)}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <StatusIcon status={run.status} disconnected={disconnected} />
            {statusLabels[run.status]}
          </span>
          <ChevronDown
            size={14}
            className={"flex-none text-muted transition-transform " + (expanded ? "rotate-180" : "")}
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </span>
        <span
          className="mt-1 overflow-hidden text-ellipsis text-[11.5px] leading-[1.45] text-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
          title={run.task}
        >
          {run.task}
        </span>
      </button>

      {disconnected ? (
        <p className="m-0 border-t border-border px-3 py-2 text-[11.5px] leading-5 text-muted" role="status">
          {t("subagentObservationDisconnected", { status: statusLabels[run.status] })}
        </p>
      ) : null}

      {expanded ? (
        <div id={contentId} className="border-t border-border px-3 py-2.5">
          {run.failure ? (
            <p className="mb-2 mt-0 text-[12px] leading-5 text-red" title={run.failure.code}>
              {failureLabel(run.failure, t)}
            </p>
          ) : null}
          <ol id={activityListId} className="m-0 space-y-1.5 p-0">
            {activities.map((activity, index) => {
              const tool = activity.kind === SubagentActivityViewKind.ToolStarted ? activity : null;
              const current = running && !disconnected && index === activities.length - 1
                && (activity.kind === SubagentActivityViewKind.ModelStarted || (tool !== null && !tool.result));
              return (
                <li
                  key={activity.id}
                  className={"flex min-w-0 items-start gap-2 text-[12px] leading-5 " + (current ? "text-fg" : "text-muted")}
                >
                  {current ? (
                    <Loader2 size={12} className="mt-1 flex-none animate-spin text-accent" strokeWidth={2} aria-hidden="true" />
                  ) : tool?.result === SubagentToolStatus.Ok ? (
                    <CheckCircle2 size={12} className="mt-1 flex-none text-green" strokeWidth={2} aria-label={t("subagentToolCompleted")} />
                  ) : tool?.result === SubagentToolStatus.Error ? (
                    <AlertCircle size={12} className="mt-1 flex-none text-red" strokeWidth={2} aria-label={t("subagentToolFailed")} />
                  ) : (
                    <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-[#3a3832]" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span>{activityLabel(activity, t)}</span>
                    {tool?.result === SubagentToolStatus.Error ? (
                      <span className="ml-2 text-red">{t("subagentToolFailed")}</span>
                    ) : null}
                    {tool?.detail ? (
                      <code className="block whitespace-pre-wrap break-all text-[11px] leading-[1.5] text-muted">{tool.detail}</code>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
          {hiddenActivityCount > 0 ? (
            <button
              type="button"
              className="mt-2 rounded py-0.5 text-[11px] text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              aria-expanded={showAll}
              aria-controls={activityListId}
              onClick={() => setShowAll((previous) => !previous)}
            >
              {showAll ? t("subagentCollapseActivities") : t("subagentShowAllActivities", { count: run.activities.length })}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
