"use client";

import Spinner from "./Spinner";
import { PHASE_LABEL, type Message } from "@/lib/types";

type AiMsg = Extract<Message, { role: "ai" }>;

function numClass(ok: boolean, failed: boolean, active: boolean) {
  const base = "w-[18px] h-[18px] rounded-full flex items-center justify-center text-[11px] flex-none ";
  if (ok) return base + "bg-green text-[#04101f]";
  if (failed) return base + "bg-red text-white";
  if (active) return base + "bg-yellow text-[#04101f]";
  return base + "bg-[#30363d] text-fg";
}

export default function AiBubble({ m, busy }: { m: AiMsg; busy: boolean }) {
  const hasHeal =
    m.attempts.length > 1 ||
    m.attempts.some((a) => a.phase === "compile-fail" || a.phase === "runtime-fail");
  const last = m.attempts[m.attempts.length - 1];

  return (
    <>
      {/* AI 直接回话/提问（reply 分支） */}
      {m.chatText && <div className="whitespace-pre-wrap">{m.chatText}</div>}

      {m.attempts.length === 0 && busy && !m.chatText && (
        <span>
          <Spinner /> 正在生成…
        </span>
      )}

      {hasHeal && (
        <div className="mt-[9px] rounded-[10px] border border-border overflow-hidden bg-[#12161d]">
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
                  第 {a.n} 次尝试 · {PHASE_LABEL[a.phase]}
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
          <Spinner /> {PHASE_LABEL[last.phase]}
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
