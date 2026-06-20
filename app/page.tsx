/**
 * [INPUT]: 用户输入/示例 chip
 * [OUTPUT]: 编排三栏 UI（对话/编辑器/预览），把各面板接到 useChat 的闭环上
 * [POS]: B 域编排域的视图层 —— 只做布局与组装；状态/闭环逻辑在 hooks/useChat
 * [PROTOCOL]: 闭环在 hooks/useChat.ts；后端调用门面在 lib/chatClient.ts（接真 /api/chat）
 */
"use client";

import { useState } from "react";
import { useChat } from "@/hooks/useChat";
import TopBar from "@/components/TopBar";
import ChatPanel from "@/components/ChatPanel";
import EditorPanel from "@/components/EditorPanel";
import PreviewPanel from "@/components/PreviewPanel";
import ExportModal from "@/components/ExportModal";
import Toast from "@/components/Toast";

export default function Page() {
  const s = useChat();
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 1900);
  }

  return (
    <div className="h-screen flex flex-col">
      <TopBar
        projName={s.projName}
        canAct={s.hasResult && !s.busy}
        onRerun={s.rerun}
        onExport={() => setExportOpen(true)}
      />

      <main className="flex-1 flex min-h-0">
        <ChatPanel
          messages={s.messages}
          busy={s.busy}
          curAiId={s.curAiId.current}
          onSend={s.send}
          onStop={s.stop}
        />
        <EditorPanel code={s.code} writing={s.writing} />
        <PreviewPanel
          iframeRef={s.iframeRef}
          status={s.status}
          overlay={s.overlay}
          setOverlay={s.setOverlay}
          previewActive={s.previewActive}
        />
      </main>

      {exportOpen && (
        <ExportModal
          code={s.code}
          projName={s.projName}
          onClose={() => setExportOpen(false)}
          onToast={showToast}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}
