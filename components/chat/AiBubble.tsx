"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Spinner from "@/components/common/Spinner";
import MarkdownMessage from "./MarkdownMessage";
import FigmaIntegrationCard from "@/components/integrations/figma/FigmaIntegrationCard";
import ImageRunCard from "./ImageRunCard";
import { AiTimelineItemKind } from "@/lib/types";
import type { AgentFileChange } from "@/lib/types";
import type { Message, Phase } from "@/lib/types";
import { useConversationStore } from "@/lib/conversationStore";

type AiMsg = Extract<Message, { role: "ai" }>;
type FileWriteStream = NonNullable<AiMsg["fileWriteStreams"]>[number];
type ChangeLabel = (change: AgentFileChange) => string;

function numClass(ok: boolean, failed: boolean, active: boolean) {
  const base = "w-[18px] h-[18px] rounded-full flex items-center justify-center text-[11px] flex-none ";
  if (ok) return base + "bg-green text-white";
  if (failed) return base + "bg-red text-white";
  if (active) return base + "bg-yellow text-white";
  return base + "bg-[#2b2a26] text-fg";
}

function lineCount(value: string) {
  if (!value) return 0;
  return value.split("\n").length;
}

function FileWriteStreamBlock({ stream }: { stream: FileWriteStream }) {
  const t = useTranslations("Chat");
  const scrollRef = useRef<HTMLPreElement>(null);
  const stickToBottomRef = useRef(true);
  const [expanded, setExpanded] = useState(!stream.collapsed);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottomDistance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setCanScrollUp(el.scrollTop > 2);
    setCanScrollDown(bottomDistance > 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    updateScrollState();
  }, [stream.content, updateScrollState]);

  useEffect(() => {
    if (stream.collapsed) setExpanded(false);
  }, [stream.collapsed]);

  if (!expanded) {
    return (
      <button
        type="button"
        className="mt-2 flex w-full min-w-0 items-center gap-2 rounded-[10px] border border-border bg-codebg px-3 py-2 text-left transition hover:border-accent"
        onClick={() => setExpanded(true)}
      >
        <span className="text-muted">▸</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">
          {stream.path ?? t("writingFile")}
        </span>
        <span className="flex-none tabular-nums text-[11px] text-muted">
          {lineCount(stream.content)} {t("lines")}
        </span>
      </button>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-[10px] border border-border bg-codebg shadow-[0_12px_34px_rgba(0,0,0,0.22)]">
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-[#10100e] px-3 py-2">
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">
          {stream.path ?? t("writingFile")}
        </span>
        <span className="flex-none tabular-nums text-[11px] text-muted">
          {lineCount(stream.content)} {t("lines")}
        </span>
        <button
          type="button"
          className="ml-1 flex-none rounded-md border border-border px-2 py-0.5 text-[11px] text-muted transition hover:border-accent hover:text-accent"
          onClick={() => setExpanded(false)}
        >
          {t("collapse")}
        </button>
      </div>

      <div className="relative">
        {canScrollUp ? (
          <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-8 bg-gradient-to-b from-codebg to-transparent" />
        ) : null}
        <pre
          ref={scrollRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            const bottomDistance = el.scrollHeight - el.scrollTop - el.clientHeight;
            stickToBottomRef.current = bottomDistance < 24;
            setCanScrollUp(el.scrollTop > 2);
            setCanScrollDown(bottomDistance > 2);
          }}
          className="max-h-[320px] min-h-[96px] overflow-auto p-3 text-[12px] leading-5 text-fg"
        >
          <code>{stream.content}</code>
        </pre>
        {canScrollDown ? (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-9 bg-gradient-to-t from-codebg to-transparent" />
        ) : null}
      </div>
    </div>
  );
}

function FileChangesBlock({ changes, changeLabel }: { changes: AgentFileChange[]; changeLabel: ChangeLabel }) {
  if (changes.length === 0) return null;

  return (
    <div className="mt-[9px] overflow-hidden rounded-[10px] border border-border bg-codebg">
      {changes.map((change) => (
        <div
          key={change.id}
          className="flex min-w-0 items-center gap-2 border-t border-border px-[11px] py-2 text-[12.5px] first:border-t-0"
        >
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent" />
          <span className="flex-none text-muted">{changeLabel(change)}</span>
          {change.operation === "rename" && change.oldPath ? (
            <span className="min-w-0 truncate font-mono text-[12px] text-fg">
              {change.oldPath} → {change.path}
            </span>
          ) : (
            <span className="min-w-0 truncate font-mono text-[12px] text-fg">{change.path}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AiBubble({ m, onResume }: { m: AiMsg; onResume: () => void }) {
  const t = useTranslations("Chat");
  const busy = useConversationStore((state) => state.busy && state.activeAiId === m.id);
  const activityText = useConversationStore((state) => state.activityText);
  const hasHeal =
    m.attempts.length > 1 ||
    m.attempts.some((a) => a.phase === "compile-fail" || a.phase === "runtime-fail");
  const last = m.attempts[m.attempts.length - 1];
  const phaseLabel: Record<Phase, string> = {
    writing: t("phaseWriting"),
    transpiling: t("phaseTranspiling"),
    running: t("phaseRunning"),
    ok: t("phaseOk"),
    "compile-fail": t("phaseCompileFail"),
    "runtime-fail": t("phaseRuntimeFail"),
  };

  function changeLabel(change: AgentFileChange) {
    if (change.operation === "delete") return t("changeDelete");
    if (change.operation === "rename") return t("changeRename");
    return t("changeWrite");
  }

  const timeline = m.timeline
    ? [...m.timeline].sort((a, b) => a.receivedAt - b.receivedAt || a.order - b.order)
    : null;

  function renderChatText(key?: string) {
    if (!m.chatText || m.integrationCard) return null;

    return (
      <div key={key} className="markdown-message mt-3">
        <MarkdownMessage content={m.chatText} />
      </div>
    );
  }

  function renderTimelineItem(item: NonNullable<typeof timeline>[number]) {
    if (item.kind === AiTimelineItemKind.Chat) return renderChatText(item.id);

    if (item.kind === AiTimelineItemKind.FileWriteStream) {
      const stream = m.fileWriteStreams?.find((candidate) => candidate.toolCallId === item.toolCallId);
      return stream ? <FileWriteStreamBlock key={item.id} stream={stream} /> : null;
    }

    if (item.kind === AiTimelineItemKind.FileChange) {
      const change = m.fileChanges?.find((candidate) => candidate.id === item.changeId);
      return change ? <FileChangesBlock key={item.id} changes={[change]} changeLabel={changeLabel} /> : null;
    }

    if (item.kind === AiTimelineItemKind.ImageRun) {
      const run = m.imageRuns?.find((candidate) => candidate.runId === item.runId);
      return run ? <ImageRunCard key={item.id} run={run} onResume={onResume} /> : null;
    }

    return null;
  }

  return (
    <>
      {m.integrationCard && (
        <div className={m.chatText ? "mb-3" : ""}>
          <FigmaIntegrationCard onResume={onResume} />
        </div>
      )}

      {m.attempts.length === 0 && busy && !m.chatText && !m.fileChanges?.length && !m.fileWriteStreams?.length && !m.imageRuns?.length && (
        <span>
          <Spinner /> {t("generating")}
        </span>
      )}

      {timeline ? (
        timeline.map(renderTimelineItem)
      ) : (
        <>
          {m.fileWriteStreams?.map((stream) => (
            <FileWriteStreamBlock key={stream.toolCallId} stream={stream} />
          ))}

          <FileChangesBlock changes={m.fileChanges ?? []} changeLabel={changeLabel} />

          {m.imageRuns?.map((run) => (
            <ImageRunCard key={run.runId} run={run} onResume={onResume} />
          ))}
        </>
      )}

      {busy && (m.fileChanges?.length || m.fileWriteStreams?.length || m.chatText) && !m.summary && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border bg-codebg px-2.5 py-1.5 text-[12.5px] text-muted">
          <Spinner />
          <span>{activityText || t("stillWorking")}</span>
        </div>
      )}

      {!timeline && renderChatText()}

      {hasHeal && (
        <div className="mt-[9px] rounded-[10px] border border-border overflow-hidden bg-codebg">
          {m.attempts.map((a) => {
            const failed = a.phase === "compile-fail" || a.phase === "runtime-fail";
            const ok = a.phase === "ok";
            const active = !ok && !failed && busy;
            return (
              <div
                key={a.n}
                className="flex items-center gap-2 px-[11px] py-2 text-[12.5px] border-t border-border first:border-t-0"
              >
                <span className={numClass(ok, failed, active)}>{ok ? "✓" : failed ? "✕" : a.n}</span>
                <span>
                  {t("attempt", { n: a.n })} · {phaseLabel[a.phase]}
                </span>
                {active && <Spinner className="ml-auto" />}
                {a.note && <span className="ml-1.5 text-red text-[11px] truncate">{a.note}</span>}
              </div>
            );
          })}
        </div>
      )}

      {!hasHeal && m.attempts.length > 0 && !m.summary && !m.chatText && busy && last && (
        <span>
          <Spinner /> {phaseLabel[last.phase]}
        </span>
      )}

      {m.summary && (
        <div>
          <span className={m.summaryKind === "ok" ? "text-green" : "text-red"}>{m.summary}</span>
          {m.diff && <div className="font-mono text-[12px] text-orange mt-[5px]">▸ {m.diff}</div>}
        </div>
      )}
    </>
  );
}
