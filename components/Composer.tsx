"use client";

import { useEffect, useRef, useState } from "react";
import {
  createPendingAttachment,
  uploadPendingAttachment,
  type PendingAttachment,
} from "@/lib/attachments";
import type { SendAttachment } from "@/lib/types";

const MAX_ATTACHMENTS = 4;

type ComposerAttachment = PendingAttachment & {
  status: "uploading" | "uploaded" | "error";
  uploaded?: SendAttachment;
  error?: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function Composer({
  busy,
  projectId,
  onSend,
  onStop,
}: {
  busy: boolean;
  projectId?: string;
  onSend: (text: string, attachments?: SendAttachment[]) => void;
  onStop: () => void;
}) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
    };
  }, []);

  function clearSentAttachments() {
    setAttachments([]);
  }

  async function uploadAttachment(attachment: ComposerAttachment) {
    setAttachments((prev) =>
      prev.map((item) =>
        item.id === attachment.id
          ? { ...item, status: "uploading", error: undefined, uploaded: undefined }
          : item
      )
    );

    try {
      const uploaded = await uploadPendingAttachment(attachment, projectId);
      setAttachments((prev) =>
        prev.map((item) =>
          item.id === attachment.id ? { ...item, status: "uploaded", uploaded, error: undefined } : item
        )
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setAttachments((prev) =>
        prev.map((item) =>
          item.id === attachment.id ? { ...item, status: "error", error: message, uploaded: undefined } : item
        )
      );
    }
  }

  function removeAttachment(id: string) {
    setError("");
    setAttachments((prev) => {
      const target = prev.find((attachment) => attachment.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((attachment) => attachment.id !== id);
    });
  }

  function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    setError("");
    const selectedFiles = Array.from(files);
    const slots = MAX_ATTACHMENTS - attachmentsRef.current.length;
    if (slots <= 0) {
      setError(`最多上传 ${MAX_ATTACHMENTS} 张图片。`);
      return;
    }

    const next: ComposerAttachment[] = [];
    for (const file of selectedFiles.slice(0, slots)) {
      try {
        next.push({ ...createPendingAttachment(file), status: "uploading" });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    if (selectedFiles.length > slots) setError(`最多上传 ${MAX_ATTACHMENTS} 张图片。`);
    if (next.length === 0) return;

    setAttachments((prev) => [...prev, ...next]);
    next.forEach((attachment) => {
      void uploadAttachment(attachment);
    });
  }

  function addClipboardImages(items: DataTransferItemList) {
    const images: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) images.push(file);
    }
    if (images.length > 0) addFiles(images);
    return images.length > 0;
  }

  function addDroppedFiles(dataTransfer: DataTransfer) {
    const files = Array.from(dataTransfer.files);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (files.length > 0 && imageFiles.length === 0) {
      setError("只支持拖入 PNG、JPEG、WebP 图片。");
      return;
    }
    addFiles(imageFiles);
  }

  async function submit() {
    const text = input.trim();
    const uploaded = attachments
      .map((attachment) => attachment.uploaded)
      .filter((attachment): attachment is SendAttachment => Boolean(attachment));
    const hasUploading = attachments.some((attachment) => attachment.status === "uploading");
    const hasError = attachments.some((attachment) => attachment.status === "error");
    if (busy || hasUploading || hasError || (!text && uploaded.length === 0)) return;

    setError("");
    onSend(text, uploaded);
    setInput("");
    clearSentAttachments();
  }

  const hasUploading = attachments.some((attachment) => attachment.status === "uploading");
  const hasUploadError = attachments.some((attachment) => attachment.status === "error");
  const uploadedAttachments = attachments
    .map((attachment) => attachment.uploaded)
    .filter((attachment): attachment is SendAttachment => Boolean(attachment));
  const canSend =
    !busy &&
    !hasUploading &&
    !hasUploadError &&
    (input.trim().length > 0 || uploadedAttachments.length > 0);
  const aggregateError = hasUploadError ? "有图片上传失败，请移除或重试后再发送。" : error;

  return (
    <div className="flex-none border-t border-border p-[12px_14px] bg-panel">
      <div
        className={
          "bg-codebg border rounded-[11px] px-[10px] py-2 transition-colors " +
          (dragActive ? "border-accent bg-[#111b2b]" : "border-border focus-within:border-accent")
        }
        onDragEnter={(e) => {
          e.preventDefault();
          if (!busy) setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (busy) return;
          addDroppedFiles(e.dataTransfer);
        }}
      >
        {attachments.length > 0 && (
          <div className="mb-2 grid grid-cols-2 gap-2">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="relative flex min-w-0 items-center gap-2 rounded-lg border border-border bg-panel2/70 p-1.5">
                <div className="relative h-10 w-10 flex-none overflow-hidden rounded-md border border-border">
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    className="h-full w-full object-cover"
                  />
                  {attachment.status === "uploading" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-semibold text-white">
                      上传中
                    </div>
                  )}
                  {attachment.status === "error" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-red/70 text-[10px] font-semibold text-white">
                      失败
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] leading-4 text-fg">{attachment.name}</div>
                  <div className="text-[10px] leading-4 text-muted">
                    {attachment.status === "uploading"
                      ? "上传中..."
                      : attachment.status === "error"
                        ? "上传失败"
                        : `${formatBytes(attachment.sizeBytes)} · 已上传`}
                  </div>
                  {attachment.status === "error" && (
                    <div className="mt-0.5 line-clamp-2 text-[10px] leading-3 text-red">
                      {attachment.error}
                    </div>
                  )}
                </div>
                {attachment.status === "error" && (
                  <button
                    type="button"
                    className="h-6 flex-none rounded-md border border-border px-1.5 text-[11px] text-accent hover:border-accent"
                    onClick={() => uploadAttachment(attachment)}
                  >
                    重试
                  </button>
                )}
                <button
                  type="button"
                  className="h-6 w-6 flex-none rounded-md border border-border text-[13px] text-muted hover:border-red hover:text-red"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`移除 ${attachment.name}`}
                  title="移除图片"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          id="chat-composer"
          name="chat-composer"
          className="w-full bg-transparent border-none outline-none text-fg resize-none text-[13.5px] leading-[1.5] h-[38px]"
          placeholder="描述你想要的界面…也可以粘贴或拖入截图"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            if (busy) return;
            const hasImage = addClipboardImages(e.clipboardData.items);
            if (hasImage) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {aggregateError && <div className="mt-1 text-[11px] leading-4 text-red">{aggregateError}</div>}

        <div className="flex items-center justify-between mt-1.5">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.currentTarget.files);
                e.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium text-muted hover:border-accent hover:text-accent disabled:opacity-45"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || attachments.length >= MAX_ATTACHMENTS}
              aria-label="上传截图"
              title="上传 PNG / JPEG / WebP 图片，也支持粘贴或拖拽"
            >
              <span className="text-[14px] leading-none">+</span>
              上传截图
            </button>
            <span className="text-[11px] text-[#5a6573]">
              粘贴/拖入图片 · 最多 {MAX_ATTACHMENTS} 张 · 单张 5MB
            </span>
          </div>

          {busy ? (
            <button
              className="bg-transparent border border-red text-red rounded-lg px-3 py-1.5 text-[13px]"
              onClick={onStop}
            >
              停止
            </button>
          ) : (
            <button
              className="bg-accent text-[#04101f] rounded-lg px-3.5 py-1.5 font-semibold text-[13px] hover:bg-[#79b8ff] disabled:opacity-45 disabled:cursor-not-allowed"
              onClick={submit}
              disabled={!canSend}
            >
              {hasUploading ? "上传中…" : "发送"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
