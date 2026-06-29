"use client";

import { useEffect, useRef } from "react";
import { MessageCircle } from "lucide-react";
import AiBubble from "./AiBubble";
import Composer from "./Composer";
import type { Message, SendAttachment, UserMessageAttachment } from "@/lib/types";
import { useConversationStore } from "@/lib/conversationStore";

const QUICK = [
  { label: "一个待办列表", prompt: "做一个待办列表" },
  { label: "一个计数器", prompt: "做一个计数器" },
  { label: "一个登录表单", prompt: "做一个登录表单" },
];

const chipBase =
  "bg-panel2 border border-border rounded-[9px] px-3 py-[9px] text-[13px] text-fg text-left flex items-center gap-[9px] transition hover:border-accent hover:translate-x-[2px]";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function UserAttachments({ attachments }: { attachments: UserMessageAttachment[] }) {
  return (
    <div className="mt-2 flex max-w-full flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex max-w-[210px] min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-1.5"
        >
          {attachment.previewUrl ? (
            <img
              src={attachment.previewUrl}
              alt={attachment.name ?? "图片附件"}
              className="h-10 w-10 flex-none rounded-md object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-white/10 text-[10px] text-white/70">
              IMG
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] leading-4 text-white/90">{attachment.name ?? "图片附件"}</div>
            <div className="text-[10px] leading-4 text-white/55">{attachment.mimeType} · {formatBytes(attachment.sizeBytes)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ChatPanel({
  messages,
  projectId,
  onSend,
  onStop,
}: {
  messages: Message[];
  projectId?: string;
  onSend: (text: string, attachments?: SendAttachment[]) => void;
  onStop: () => void;
}) {
  const busy = useConversationStore((state) => state.busy);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  return (
    <div className="flex flex-col min-w-0 h-full w-full bg-panel">
      <div className="h-9 flex-none flex items-center gap-2 px-[14px] border-b border-border text-[12px] text-muted uppercase tracking-[0.06em]">
        <MessageCircle size={14} strokeWidth={1.8} /> AI 对话 · Agent
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-[18px_16px] flex flex-col gap-4">
        {messages.length === 0 && (
          <div className="text-muted leading-[1.7]">
            <h3 className="text-fg text-[15px] m-0 mb-1.5">描述你想做的 React 界面</h3>
            我来帮你写代码、运行，跑挂了还会自己修。
            <div className="text-[11px] text-muted uppercase tracking-[0.08em] mt-4 mb-0.5">快速开始</div>
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
            <div key={m.id} className="flex max-w-full justify-end">
              <div className="max-w-[min(76%,680px)] rounded-2xl rounded-tr-md bg-bubble px-3.5 py-2.5 text-[13.5px] leading-[1.65] text-white">
                {m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>}
                {m.attachments?.length ? <UserAttachments attachments={m.attachments} /> : null}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex max-w-full">
              <div className="min-w-0 max-w-[min(88%,760px)] rounded-2xl rounded-tl-md border border-border bg-panel2/95 px-3.5 py-2.5 text-[13.5px] leading-[1.65] text-fg">
                <AiBubble m={m} />
              </div>
            </div>
          )
        )}
      </div>

      <Composer busy={busy} projectId={projectId} onSend={onSend} onStop={onStop} />
    </div>
  );
}
