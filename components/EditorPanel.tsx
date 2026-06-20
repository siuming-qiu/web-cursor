"use client";

import dynamic from "next/dynamic";
import Spinner from "./Spinner";

const CodeEditor = dynamic(() => import("./CodeEditor"), { ssr: false });

export default function EditorPanel({ code, writing }: { code: string; writing: boolean }) {
  return (
    <div className="flex flex-col min-w-0 h-full flex-[1.05] border-r border-border bg-codebg">
      <div className="h-9 flex-none flex items-center gap-2 px-[14px] border-b border-border text-[12px] text-muted uppercase tracking-[0.06em]">
        <span>📄</span> App.tsx
      </div>
      <div className="flex-1 relative min-h-0">
        {!code && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-[#3a4150] gap-2 font-mono text-[13px] z-[1] px-6">
            // 还没有代码 — 在左侧描述需求，AI 会写在这里
          </div>
        )}
        {writing && (
          <div className="absolute top-2.5 right-4 z-[3] flex items-center gap-1.5 text-[11px] text-accent bg-codebg/80 px-2 py-[3px] rounded-md">
            <Spinner /> AI 正在写入…
          </div>
        )}
        {code && <CodeEditor value={code} />}
      </div>
    </div>
  );
}
