"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, ExternalLink, ImageIcon, Loader2 } from "lucide-react";
import { fetchImageRun, imageRunTerminal } from "@/lib/imageRuns";
import type { ImageJobView, ImageRunView } from "@/lib/types";
import { ImageJobStatus, ImageRunStatus } from "@/types/image";

function jobTitle(job: ImageJobView, index: number, fallback: string) {
  return job.input.label?.trim() || `${fallback} ${index + 1}`;
}

function statusTone(status: ImageRunView["status"]) {
  if (status === ImageRunStatus.Succeeded) return "text-green";
  if (status === ImageRunStatus.Failed) return "text-red";
  return "text-yellow";
}

function statusText(status: ImageRunView["status"], t: ReturnType<typeof useTranslations<"Chat">>) {
  if (status === ImageRunStatus.Succeeded) return t("imageRunSucceeded");
  if (status === ImageRunStatus.Failed) return t("imageRunFailed");
  return t("imageRunRunning");
}

function JobPreview({ job, index }: { job: ImageJobView; index: number }) {
  const t = useTranslations("Chat");
  const title = jobTitle(job, index, t("imageJob"));

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-codebg">
      <div className="relative aspect-video bg-panel2">
        {job.status === ImageJobStatus.Succeeded && job.result ? (
          <a href={job.result.url} target="_blank" rel="noreferrer" className="group block h-full w-full">
            <img src={job.result.url} alt={title} className="h-full w-full object-cover" />
            <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-black/55 text-white opacity-0 transition group-hover:opacity-100">
              <ExternalLink size={14} strokeWidth={2} />
            </span>
          </a>
        ) : job.status === ImageJobStatus.Failed ? (
          <div className="flex h-full items-center justify-center text-red">
            <AlertCircle size={22} strokeWidth={1.9} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-panel">
              <Loader2 size={20} className="animate-spin text-accent" strokeWidth={1.9} />
            </div>
          </div>
        )}
      </div>
      <div className="min-w-0 px-2.5 py-2">
        <div className="truncate text-[12px] text-fg">{title}</div>
        <div className="mt-0.5 max-h-8 overflow-hidden text-[11px] leading-4 text-muted">{job.input.prompt}</div>
        {job.error ? <div className="mt-1 text-[11px] leading-4 text-red">{job.error.message}</div> : null}
      </div>
    </div>
  );
}

export default function ImageRunCard({ run, onResume }: { run: ImageRunView; onResume: () => void }) {
  const t = useTranslations("Chat");
  const [current, setCurrent] = useState(run);
  const terminalNotifiedRef = useRef(false);

  useEffect(() => {
    setCurrent(run);
  }, [run]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;

    async function tick() {
      try {
        const next = await fetchImageRun(run.runId);
        if (disposed) return;
        setCurrent({ ...next, resumeOnTerminal: run.resumeOnTerminal });
        if (!imageRunTerminal(next.status)) {
          timer = window.setTimeout(tick, 2000);
          return;
        }
        if (run.resumeOnTerminal && !terminalNotifiedRef.current) {
          terminalNotifiedRef.current = true;
          onResume();
        }
      } catch {
        if (!disposed) timer = window.setTimeout(tick, 3000);
      }
    }

    if (!imageRunTerminal(run.status)) {
      timer = window.setTimeout(tick, 800);
    }

    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [onResume, run.resumeOnTerminal, run.runId, run.status]);

  const Icon = current.status === ImageRunStatus.Succeeded
    ? CheckCircle2
    : current.status === ImageRunStatus.Failed
      ? AlertCircle
      : ImageIcon;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-panel/70">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon size={15} className={statusTone(current.status)} strokeWidth={2} />
        <span className="text-[12.5px] font-medium text-fg">{statusText(current.status, t)}</span>
        {current.status === ImageRunStatus.Pending || current.status === ImageRunStatus.Running ? (
          <Loader2 size={13} className="ml-auto animate-spin text-muted" strokeWidth={2} />
        ) : null}
      </div>
      <div className="grid gap-2 p-2">
        {current.jobs.map((job, index) => (
          <JobPreview key={job.id} job={job} index={index} />
        ))}
      </div>
    </div>
  );
}
