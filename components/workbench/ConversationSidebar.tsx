"use client";

import { useLocale, useTranslations } from "next-intl";
import { Loader2, MessageSquare, Plus } from "lucide-react";
import ChatPanel from "@/components/chat/ChatPanel";
import { formatTime, type Conversation } from "@/lib/projectTypes";
import type { Message, SendAttachment } from "@/lib/types";

type ConversationSidebarProps = {
  conversations: Conversation[];
  currentConversationId?: string;
  loadingConversationId: string | null;
  messages: Message[];
  projectId?: string;
  onNewConversation: () => void;
  onOpenConversation: (conversationId: string) => void;
  onSend: (text: string, attachments?: SendAttachment[]) => void;
  onResume: () => void;
  onStop: () => void;
};

export default function ConversationSidebar({
  conversations,
  currentConversationId,
  loadingConversationId,
  messages,
  projectId,
  onNewConversation,
  onOpenConversation,
  onSend,
  onResume,
  onStop,
}: ConversationSidebarProps) {
  const t = useTranslations("Workbench");
  const locale = useLocale();

  return (
    <div className="flex h-full w-[380px] flex-none flex-col border-r border-border bg-panel">
      <div className="h-9 flex-none flex items-center justify-between gap-2 px-[14px] border-b border-border text-[12px] text-muted uppercase tracking-[0.06em]">
        <span>{t("conversationThreads")}</span>
        <button
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-panel2 px-2.5 text-[12px] text-accent transition hover:border-accent hover:bg-[#1b1713]"
          onClick={onNewConversation}
        >
          <Plus size={14} strokeWidth={2} />
          {t("newConversation")}
        </button>
      </div>
      <div className="max-h-[160px] flex-none overflow-y-auto border-b border-border p-2">
        {conversations.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] leading-5 text-muted">
            {t("emptyHistory")}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {conversations.map((conversation) => {
              const active = conversation.id === currentConversationId;
              const loading = conversation.id === loadingConversationId;
              return (
                <button
                  key={conversation.id}
                  className={
                    "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition " +
                    (active ? "border-accent bg-[#1b1713]" : "border-transparent hover:bg-panel2")
                  }
                  onClick={() => onOpenConversation(conversation.id)}
                >
                  <span
                    className={
                      "inline-flex h-6 w-6 flex-none items-center justify-center rounded-md " +
                      (active ? "text-accent" : "text-muted")
                    }
                  >
                    {loading ? (
                      <Loader2 size={14} className="animate-spin" strokeWidth={2} />
                    ) : (
                      <MessageSquare size={14} strokeWidth={1.9} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-fg">
                      {conversation.title || t("untitledConversation")}
                    </span>
                    <span className="block text-[11px] text-muted">{formatTime(conversation.createdAt, locale)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ChatPanel
          messages={messages}
          projectId={projectId}
          onSend={onSend}
          onResume={onResume}
          onStop={onStop}
        />
      </div>
    </div>
  );
}
