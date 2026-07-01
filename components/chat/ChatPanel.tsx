"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageCircle } from "lucide-react";
import AiBubble from "./AiBubble";
import Composer from "./Composer";
import type { Message, SendAttachment, UserMessageAttachment } from "@/lib/types";
import { useConversationStore } from "@/lib/conversationStore";

const chipBase =
  "bg-panel2 border border-border rounded-[9px] px-3 py-[9px] text-[13px] text-fg text-left flex items-center gap-[9px] transition hover:border-accent hover:translate-x-[2px]";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function UserAttachments({ attachments }: { attachments: UserMessageAttachment[] }) {
  const t = useTranslations("Chat");
  const [preview, setPreview] = useState<{
    attachment: UserMessageAttachment;
    left: number;
    top: number;
  } | null>(null);

  function showPreview(attachment: UserMessageAttachment, target: HTMLElement) {
    if (!attachment.previewUrl) return;

    const rect = target.getBoundingClientRect();
    const previewWidth = 340;
    const gap = 12;
    const leftSpace = rect.left - gap;
    const rightSpace = window.innerWidth - rect.right - gap;
    const left = rightSpace >= previewWidth || rightSpace >= leftSpace
      ? Math.min(rect.right + gap, window.innerWidth - previewWidth - gap)
      : Math.max(gap, rect.left - previewWidth - gap);
    const top = Math.min(Math.max(gap, rect.top), window.innerHeight - 300 - gap);

    setPreview({ attachment, left, top });
  }

  return (
    <>
      <div className="mt-2 flex max-w-full flex-wrap gap-2">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            tabIndex={attachment.previewUrl ? 0 : -1}
            className="flex max-w-[210px] min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-1.5 outline-none transition hover:border-white/30 focus-visible:border-white/40"
            onMouseEnter={(event) => showPreview(attachment, event.currentTarget)}
            onFocus={(event) => showPreview(attachment, event.currentTarget)}
            onMouseLeave={() => setPreview(null)}
            onBlur={() => setPreview(null)}
          >
            {attachment.previewUrl ? (
              <img
                src={attachment.previewUrl}
                alt={attachment.name ?? t("imageAttachment")}
                className="h-10 w-10 flex-none rounded-md object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-white/10 text-[10px] text-white/70">
                IMG
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] leading-4 text-white/90">{attachment.name ?? t("imageAttachment")}</div>
              <div className="text-[10px] leading-4 text-white/55">{attachment.mimeType} · {formatBytes(attachment.sizeBytes)}</div>
            </div>
          </div>
        ))}
      </div>

      {preview?.attachment.previewUrl ? (
        <div
          className="pointer-events-none fixed z-[80] overflow-hidden rounded-xl border border-white/15 bg-[#0d0c0a] p-2 shadow-[0_18px_60px_rgba(0,0,0,0.48)]"
          style={{ left: preview.left, top: preview.top, width: 340 }}
        >
          <img
            src={preview.attachment.previewUrl}
            alt={preview.attachment.name ?? t("imageAttachment")}
            className="max-h-[280px] w-full rounded-lg object-contain"
          />
          <div className="mt-2 flex min-w-0 items-center justify-between gap-3 px-1 pb-0.5">
            <span className="min-w-0 truncate text-[11px] text-white/85">
              {preview.attachment.name ?? t("imageAttachment")}
            </span>
            <span className="flex-none text-[10px] text-white/45">{formatBytes(preview.attachment.sizeBytes)}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function ChatPanel({
  messages,
  projectId,
  onSend,
  onResume,
  onStop,
  readOnly = false,
}: {
  messages: Message[];
  projectId?: string;
  onSend: (text: string, attachments?: SendAttachment[]) => void;
  onResume: () => void;
  onStop: () => void;
  readOnly?: boolean;
}) {
  const t = useTranslations("Chat");
  const busy = useConversationStore((state) => state.busy);
  const scrollRef = useRef<HTMLDivElement>(null);
  const quick = [
    { label: t("quickTodo"), prompt: t("promptTodo") },
    { label: t("quickCounter"), prompt: t("promptCounter") },
    { label: t("quickLogin"), prompt: t("promptLogin") },
  ];
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  return (
    <div className="flex flex-col min-w-0 h-full w-full bg-panel">
      <div className="h-9 flex-none flex items-center gap-2 px-[14px] border-b border-border text-[12px] text-muted uppercase tracking-[0.06em]">
        <MessageCircle size={14} strokeWidth={1.8} /> {t("title")}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-[18px_16px] flex flex-col gap-4">
        {messages.length === 0 && (
          <div className="text-muted leading-[1.7]">
            <h3 className="text-fg text-[15px] m-0 mb-1.5">{t("emptyTitle")}</h3>
            {t("emptyDescription")}
            <div className="text-[11px] text-muted uppercase tracking-[0.08em] mt-4 mb-0.5">{t("quickStart")}</div>
            <div className="flex flex-col gap-2 mt-3.5">
              {quick.map((c) => (
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
              <div
                className={
                  m.integrationCard
                    ? "min-w-0 w-full max-w-[min(88%,760px)] text-[13.5px] leading-[1.65] text-fg"
                    : "min-w-0 max-w-[min(88%,760px)] rounded-2xl rounded-tl-md border border-border bg-panel2/95 px-3.5 py-2.5 text-[13.5px] leading-[1.65] text-fg"
                }
              >
                <AiBubble m={m} onResume={onResume} />
              </div>
            </div>
          )
        )}
      </div>

      {!readOnly && <Composer busy={busy} projectId={projectId} onSend={onSend} onStop={onStop} />}
    </div>
  );
}
