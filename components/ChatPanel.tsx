"use client";

import { useEffect, useRef } from "react";
import AiBubble from "./AiBubble";
import Composer from "./Composer";
import type { Message } from "@/lib/types";

const QUICK = [
  { label: "一个待办列表", prompt: "做一个待办列表" },
  { label: "一个计数器", prompt: "做一个计数器" },
  { label: "一个登录表单", prompt: "做一个登录表单" },
];

const chipBase =
  "bg-panel2 border border-border rounded-[9px] px-3 py-[9px] text-[13px] text-fg text-left flex items-center gap-[9px] transition hover:border-accent hover:translate-x-[2px]";

export default function ChatPanel({
  messages,
  busy,
  curAiId,
  onSend,
  onStop,
}: {
  messages: Message[];
  busy: boolean;
  curAiId: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  return (
    <div className="flex flex-col min-w-0 h-full w-[340px] flex-none border-r border-border bg-panel">
      <div className="h-9 flex-none flex items-center gap-2 px-[14px] border-b border-border text-[12px] text-muted uppercase tracking-[0.06em]">
        <span>💬</span> AI 对话 · Agent
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-[16px_14px] flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="text-muted leading-[1.7]">
            <h3 className="text-fg text-[15px] m-0 mb-1.5">👋 描述你想做的 React 界面</h3>
            我来帮你写代码、运行，跑挂了还会自己修。
            <div className="text-[11px] text-[#5a6573] uppercase tracking-[0.08em] mt-4 mb-0.5">快速开始</div>
            <div className="flex flex-col gap-2 mt-3.5">
              {QUICK.map((c) => (
                <button key={c.label} className={chipBase} onClick={() => onSend(c.prompt)}>
                  <span className="text-accent">⌁</span> {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex flex-row-reverse gap-[9px] max-w-full">
              <div className="w-[26px] h-[26px] rounded-[7px] flex-none flex items-center justify-center text-sm bg-bubble">🧑</div>
              <div className="px-3 py-[9px] rounded-[11px] rounded-tr-[3px] leading-[1.6] text-[13.5px] break-words bg-bubble text-white">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-[9px] max-w-full">
              <div className="w-[26px] h-[26px] rounded-[7px] flex-none flex items-center justify-center text-sm bg-[#30363d]">🤖</div>
              <div className="px-3 py-[9px] rounded-[11px] rounded-tl-[3px] leading-[1.6] text-[13.5px] break-words bg-panel2 border border-border min-w-0">
                <AiBubble m={m} busy={busy && m.id === curAiId} />
              </div>
            </div>
          )
        )}
      </div>

      <Composer busy={busy} onSend={onSend} onStop={onStop} />
    </div>
  );
}
