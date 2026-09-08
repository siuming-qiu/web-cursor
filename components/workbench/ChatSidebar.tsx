"use client";

import ChatPanel from "@/components/chat/ChatPanel";
import type { Message, SendAttachment } from "@/lib/types";

type ChatSidebarProps = {
  messages: Message[];
  projectId?: string;
  onSend: (text: string, attachments?: SendAttachment[]) => void;
  onResume: () => void;
  onStop: () => void;
};

export default function ChatSidebar({
  messages,
  projectId,
  onSend,
  onResume,
  onStop,
}: ChatSidebarProps) {
  return (
    <div className="h-full w-[340px] flex-none border-l border-border bg-panel">
      <ChatPanel
        messages={messages}
        projectId={projectId}
        scrollContextKey={projectId ?? "unbound-project"}
        onSend={onSend}
        onResume={onResume}
        onStop={onStop}
      />
    </div>
  );
}
