"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Paperclip, RefreshCw, Square, X } from "lucide-react";
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
  const t = useTranslations("Composer");
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
      setError(t("tooMany", { max: MAX_ATTACHMENTS }));
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
    if (selectedFiles.length > slots) setError(t("tooMany", { max: MAX_ATTACHMENTS }));
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
      setError(t("onlyImages"));
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
  const aggregateError = hasUploadError ? t("aggregateError") : error;

  return (
    <div className="flex-none border-t border-border bg-panel p-[10px_14px]">
      <div
        className={
          "rounded-[22px] border bg-codebg px-3 py-2 transition-colors " +
          (dragActive ? "border-accent bg-[#1b1713]" : "border-border focus-within:border-accent")
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
          <div className="mb-2 flex max-w-full flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="relative flex max-w-[230px] min-w-0 items-center gap-2 rounded-xl border border-border bg-panel2/70 p-1.5"
              >
                <div className="relative h-10 w-10 flex-none overflow-hidden rounded-md border border-border">
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    className="h-full w-full object-cover"
                  />
                  {attachment.status === "uploading" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-semibold text-white">
                      {t("uploading")}
                    </div>
                  )}
                  {attachment.status === "error" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-red/70 text-[10px] font-semibold text-white">
                      {t("failed")}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] leading-4 text-fg">{attachment.name}</div>
                  <div className="text-[10px] leading-4 text-muted">
                    {attachment.status === "uploading"
                      ? t("uploading")
                      : attachment.status === "error"
                        ? t("uploadFailed")
                        : `${formatBytes(attachment.sizeBytes)} · ${t("uploaded")}`}
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
                    className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-muted transition hover:bg-white/10 hover:text-accent"
                    onClick={() => uploadAttachment(attachment)}
                    aria-label={t("retryUpload")}
                    title={t("retryUpload")}
                  >
                    <RefreshCw size={13} strokeWidth={2} />
                  </button>
                )}
                <button
                  type="button"
                  className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-muted transition hover:bg-red/10 hover:text-red"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={t("removeNamed", { name: attachment.name })}
                  title={t("removeImage")}
                >
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          id="chat-composer"
          name="chat-composer"
          className="max-h-36 min-h-[40px] w-full resize-none border-none bg-transparent px-1 pt-1 text-[13.5px] leading-[1.55] text-fg outline-none placeholder:text-muted/70"
          placeholder={t("placeholder")}
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

        <div className="mt-1.5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
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
              className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full text-muted transition hover:bg-white/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || attachments.length >= MAX_ATTACHMENTS}
              aria-label={t("uploadScreenshot")}
              title={t("uploadHelp")}
            >
              <Paperclip size={17} strokeWidth={2} />
            </button>
            <span className="truncate text-[11px] text-muted">
              {t("hint", { max: MAX_ATTACHMENTS })}
            </span>
          </div>

          {busy ? (
            <button
              className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full bg-red/15 text-red transition hover:bg-red/25"
              onClick={onStop}
              type="button"
              aria-label={t("stop")}
              title={t("stop")}
            >
              <Square size={14} fill="currentColor" strokeWidth={2} />
            </button>
          ) : (
            <button
              className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent text-white transition hover:bg-[#d04200] disabled:cursor-not-allowed disabled:bg-[#2b2a26] disabled:text-muted"
              onClick={submit}
              disabled={!canSend}
              type="button"
              aria-label={hasUploading ? t("uploading") : t("send")}
              title={hasUploading ? t("uploading") : t("send")}
            >
              {hasUploading ? "…" : <ArrowUp size={17} strokeWidth={2.4} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
