"use client";

import { useTranslations } from "next-intl";
import Spinner from "./Spinner";
import MarkdownMessage from "./MarkdownMessage";
import FigmaIntegrationCard from "./FigmaIntegrationCard";
import type { AgentFileChange } from "@/lib/types";
import type { Message, Phase } from "@/lib/types";
import { useConversationStore } from "@/lib/conversationStore";

type AiMsg = Extract<Message, { role: "ai" }>;

function numClass(ok: boolean, failed: boolean, active: boolean) {
  const base = "w-[18px] h-[18px] rounded-full flex items-center justify-center text-[11px] flex-none ";
  if (ok) return base + "bg-green text-white";
  if (failed) return base + "bg-red text-white";
  if (active) return base + "bg-yellow text-white";
  return base + "bg-[#2b2a26] text-fg";
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

  return (
    <>
      {m.integrationCard && (
        <div className={m.chatText ? "mb-3" : ""}>
          <FigmaIntegrationCard onResume={onResume} />
        </div>
      )}

      {/* AI 直接回话/提问（reply 分支） */}
      {m.chatText && !m.integrationCard && (
        <div className="markdown-message">
          <MarkdownMessage content={m.chatText} />
        </div>
      )}

      {m.attempts.length === 0 && busy && !m.chatText && !m.fileChanges?.length && (
        <span>
          <Spinner /> {t("generating")}
        </span>
      )}

      {m.fileChanges?.length ? (
        <div className="mt-[9px] overflow-hidden rounded-[10px] border border-border bg-codebg">
          {m.fileChanges.map((change) => (
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
      ) : null}

      {busy && (m.fileChanges?.length || m.chatText) && !m.summary && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border bg-codebg px-2.5 py-1.5 text-[12.5px] text-muted">
          <Spinner />
          <span>{activityText || t("stillWorking")}</span>
        </div>
      )}

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
