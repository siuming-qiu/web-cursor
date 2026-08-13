/**
 * [INPUT]: BrowserGitProjectRepository actions + current repository revision + sidebar collapse action
 * [OUTPUT]: status/stage/unstage/commit/log UI; Database projects get an explicit migration entry
 * [POS]: B 域 Source Control 状态 owner —— UI 状态与 Git external state 的边界
 * [PROTOCOL]: author/message are explicit user input; no inferred identity and no automatic commit.
 */
"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, ChevronLeft, GitBranch, History, Minus, Plus, RefreshCw } from "lucide-react";
import type {
  GitCommitInput,
  GitLogResult,
  GitStatusResult,
} from "@/types/browserGitRepository";
import { ProjectStorageKind, type ProjectStorageKind as ProjectStorageKindValue } from "@/types/projectStorage";
import {
  gitChangeCode,
  hasStagedChange,
  hasWorkingTreeChange,
  type GitStatusFile,
} from "@/lib/projectRepository/gitStatus";

type SourceControlModel = {
  storageKind?: ProjectStorageKindValue;
  repositoryRevision: number;
  gitOperationRevision: number;
  status(): Promise<GitStatusResult>;
  currentBranch(): Promise<{ branch: string | null }>;
  log(): Promise<GitLogResult>;
  stage(path: string): Promise<GitStatusResult>;
  unstage(path: string): Promise<GitStatusResult>;
  commit(input: GitCommitInput): Promise<{ oid: string }>;
};

function ChangeRow({
  file,
  action,
  actionLabel,
  actionIcon,
  disabled,
}: {
  file: GitStatusFile;
  action(): void;
  actionLabel: string;
  actionIcon: "plus" | "minus";
  disabled: boolean;
}) {
  return (
    <div className="group flex h-7 items-center gap-2 px-3 text-xs text-muted hover:bg-panel2">
      <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>{file.path}</span>
      <button
        type="button"
        className="invisible grid h-5 w-5 place-items-center rounded text-fg hover:bg-[#3a352f] group-hover:visible disabled:opacity-40"
        aria-label={`${actionLabel} ${file.path}`}
        title={actionLabel}
        disabled={disabled}
        onClick={action}
      >
        {actionIcon === "plus" ? <Plus size={13} /> : <Minus size={13} />}
      </button>
      <span className="w-4 text-center font-mono font-semibold text-accent">{gitChangeCode(file)}</span>
    </div>
  );
}

export default function SourceControlPanel({
  model,
  onMigrate,
  onCollapse,
}: {
  model: SourceControlModel;
  onMigrate(): void;
  onCollapse(): void;
}) {
  const [status, setStatus] = useState<GitStatusResult>({ files: [] });
  const [log, setLog] = useState<GitLogResult>({ commits: [] });
  const [branch, setBranch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");

  const refresh = useCallback(async () => {
    if (model.storageKind !== ProjectStorageKind.BrowserGit) return;
    setLoading(true);
    setError("");
    try {
      const [nextStatus, nextBranch, nextLog] = await Promise.all([
        model.status(),
        model.currentBranch(),
        model.log(),
      ]);
      setStatus(nextStatus);
      setBranch(nextBranch.branch);
      setLog(nextLog);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [model]);

  useEffect(() => {
    void refresh();
  }, [model.gitOperationRevision, model.repositoryRevision, refresh]);

  async function mutate(action: () => Promise<GitStatusResult>) {
    setLoading(true);
    setError("");
    try {
      setStatus(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  async function submitCommit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await model.commit({
        message,
        author: { name: authorName, email: authorEmail },
      });
      setMessage("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoading(false);
    }
  }

  if (model.storageKind !== ProjectStorageKind.BrowserGit) {
    return (
      <section className="flex h-full flex-col bg-panel">
        <div className="flex h-9 items-center px-4 text-[11px] uppercase tracking-[0.08em] text-muted">
          <span>Source Control</span>
          <button
            type="button"
            className="ml-auto grid h-6 w-6 place-items-center rounded hover:bg-panel2 hover:text-fg"
            aria-label="收起左侧栏"
            title="收起左侧栏"
            onClick={onCollapse}
          >
            <ChevronLeft size={14} />
          </button>
        </div>
        <div className="m-3 rounded border border-border bg-panel2 p-3 text-xs leading-5 text-muted">
          <p>当前项目使用 Database 存储，没有 Git working tree。</p>
          <button
            type="button"
            className="mt-3 w-full rounded bg-accent px-3 py-2 font-semibold text-white hover:bg-[#d04200]"
            onClick={onMigrate}
          >
            转为 Browser Git
          </button>
        </div>
      </section>
    );
  }

  const staged = status.files.filter(hasStagedChange);
  const changes = status.files.filter(hasWorkingTreeChange);

  return (
    <section className="flex h-full min-h-0 flex-col bg-panel" aria-label="Source Control">
      <div className="flex h-9 flex-none items-center gap-2 px-4 text-[11px] uppercase tracking-[0.08em] text-muted">
        <span>Source Control</span>
        <div className="ml-auto flex items-center">
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded hover:bg-panel2 hover:text-fg"
            aria-label="刷新 Git 状态"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded hover:bg-panel2 hover:text-fg"
            aria-label="收起左侧栏"
            title="收起左侧栏"
            onClick={onCollapse}
          >
            <ChevronLeft size={14} />
          </button>
        </div>
      </div>
      <div className="flex h-8 flex-none items-center gap-2 border-y border-border px-3 text-xs text-fg">
        <GitBranch size={13} className="text-accent" />
        <span className="truncate font-mono">{branch ?? "(detached)"}</span>
      </div>

      <form className="flex-none border-b border-border p-2.5" onSubmit={submitCommit}>
        <textarea
          required
          rows={2}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="提交消息"
          className="w-full resize-none rounded border border-border bg-codebg px-2.5 py-2 text-xs text-fg outline-none focus:border-accent"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            required
            value={authorName}
            onChange={(event) => setAuthorName(event.target.value)}
            placeholder="作者名称"
            className="min-w-0 rounded border border-border bg-codebg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
          />
          <input
            required
            type="email"
            value={authorEmail}
            onChange={(event) => setAuthorEmail(event.target.value)}
            placeholder="作者邮箱"
            className="min-w-0 rounded border border-border bg-codebg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
          />
        </div>
        <button
          type="submit"
          disabled={loading || staged.length === 0}
          className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded bg-accent text-xs font-semibold text-white hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check size={14} />
          提交已暂存更改
        </button>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-border py-1">
          <div className="flex h-7 items-center px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg">
            Changes <span className="ml-auto text-muted">{changes.length}</span>
          </div>
          {changes.map((file) => (
            <ChangeRow
              key={`change-${file.path}`}
              file={file}
              action={() => void mutate(() => model.stage(file.path))}
              actionLabel="暂存更改"
              actionIcon="plus"
              disabled={loading}
            />
          ))}
        </div>
        <div className="border-b border-border py-1">
          <div className="flex h-7 items-center px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg">
            Staged Changes <span className="ml-auto text-muted">{staged.length}</span>
          </div>
          {staged.map((file) => (
            <ChangeRow
              key={`staged-${file.path}`}
              file={file}
              action={() => void mutate(() => model.unstage(file.path))}
              actionLabel="取消暂存"
              actionIcon="minus"
              disabled={loading}
            />
          ))}
        </div>
        <div className="py-1">
          <div className="flex h-7 items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg">
            <History size={12} /> History
          </div>
          {log.commits.slice(0, 10).map((commit) => (
            <div key={commit.oid} className="border-t border-border/60 px-3 py-2 text-xs">
              <div className="truncate text-fg" title={commit.message}>{commit.message.split("\n")[0]}</div>
              <div className="mt-1 font-mono text-[10px] text-muted">{commit.oid.slice(0, 7)} · {commit.author.name}</div>
            </div>
          ))}
        </div>
      </div>
      {error && <div className="flex-none border-t border-red/30 bg-red/10 px-3 py-2 text-[11px] leading-4 text-[#ffd0cc]">{error}</div>}
    </section>
  );
}

export type { SourceControlModel };
