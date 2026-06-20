"use client";

import { useState } from "react";

export default function Composer({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [input, setInput] = useState("");

  function submit() {
    if (!input.trim()) return;
    onSend(input);
    setInput("");
  }

  return (
    <div className="flex-none border-t border-border p-[12px_14px] bg-panel">
      <div className="bg-codebg border border-border rounded-[11px] px-[10px] py-2 focus-within:border-accent transition-colors">
        <textarea
          className="w-full bg-transparent border-none outline-none text-fg resize-none text-[13.5px] leading-[1.5] h-[38px]"
          placeholder="描述你想要的界面…（例如：做一个待办列表）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[11px] text-[#5a6573]">⏎ 发送 · ⇧⏎ 换行</span>
          {busy ? (
            <button
              className="bg-transparent border border-red text-red rounded-lg px-3 py-1.5 text-[13px]"
              onClick={onStop}
            >
              ■ 停止
            </button>
          ) : (
            <button
              className="bg-accent text-[#04101f] rounded-lg px-3.5 py-1.5 font-semibold text-[13px] hover:bg-[#79b8ff] disabled:opacity-45 disabled:cursor-not-allowed"
              onClick={submit}
              disabled={!input.trim()}
            >
              发送 ⏎
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
