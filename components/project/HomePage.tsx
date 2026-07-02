/**
 * [INPUT]: 服务端预取的公开案例摘要；客户端按 owner 拉取历史项目
 * [OUTPUT]: 首页项目入口、prompt composer、案例入口；提交后切入 Workbench 生成
 * [POS]: B 域首页交互层 —— 只拥有首页 UI 状态，不复制 agent/workbench 状态
 * [PROTOCOL]: 历史项目来自 /api/projects；生成入口复用 Workbench 的 /api/chat 流程。
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  ChevronDown,
  ExternalLink,
  FileText,
  Menu,
  PanelsTopLeft,
  Plus,
} from "lucide-react";
import { req } from "@/lib/api";
import type { Project } from "@/lib/projectTypes";
import { formatTime } from "@/lib/projectTypes";
import type { ShowcaseListItem } from "@/lib/showcaseTypes";
import type { SendAttachment } from "@/lib/types";
import Composer from "@/components/chat/Composer";
import Workbench from "@/components/Workbench";

type HomePageProps = {
  showcases: ShowcaseListItem[];
};

type StartedTurn = {
  prompt: string;
  attachments: SendAttachment[];
};

export default function HomePage({ showcases }: HomePageProps) {
  const router = useRouter();
  const common = useTranslations("Common");
  const locale = useLocale();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [localeOpen, setLocaleOpen] = useState(false);
  const [composerResetSignal, setComposerResetSignal] = useState(0);
  const [startedTurn, setStartedTurn] = useState<StartedTurn | null>(null);

  const visibleProjects = useMemo(() => projects.slice(0, 10), [projects]);
  const currentLocaleLabel = locale === "en" ? "EN" : "中";
  const languageOptions = [
    { value: "en" as const, label: common("english") },
    { value: "zh" as const, label: common("chinese") },
  ];
  const suggestions = useMemo(
    () => showcases.slice(0, 3).map((item) => ({
      label: item.title,
      prompt: item.description || item.conversationTitle || item.projectTitle,
      slug: item.slug,
    })),
    [showcases]
  );

  useEffect(() => {
    let alive = true;
    setLoadingProjects(true);
    req<Project[]>("GET", "/api/projects")
      .then((rows) => {
        if (alive) setProjects(rows);
      })
      .catch(() => {
        if (alive) setProjects([]);
      })
      .finally(() => {
        if (alive) setLoadingProjects(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const startGeneration = useCallback((text: string, attachments: SendAttachment[] = []) => {
    setStartedTurn({ prompt: text, attachments });
  }, []);

  function switchLocale(nextLocale: "zh" | "en") {
    setLocaleOpen(false);
    if (nextLocale === locale) return;
    document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; SameSite=Lax`;
    window.location.reload();
  }

  if (startedTurn) {
    return <Workbench initialPrompt={startedTurn.prompt} initialAttachments={startedTurn.attachments} />;
  }

  return (
    <div
      className={
        "grid h-screen min-h-0 bg-[#050505] text-[#f7f7f4] " +
        (collapsed ? "grid-cols-[64px_minmax(0,1fr)]" : "grid-cols-[260px_minmax(0,1fr)]")
      }
    >
      <aside className="hidden min-w-0 flex-col border-r border-[#24231f] bg-[#070706] md:flex">
        <div className={"flex h-14 items-center gap-3 border-b border-[#24231f] " + (collapsed ? "justify-center px-3" : "justify-between px-4")}>
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 text-left"
            onClick={() => router.push("/")}
            aria-label="Web Cursor 首页"
          >
            <span className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-[#2d2b25] bg-[#0d0d0b]">
              <img src="/icon.png" alt="" className="h-5 w-5 rounded-[4px]" />
            </span>
            {!collapsed && <span className="truncate text-sm font-semibold">Web Cursor</span>}
          </button>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#24231f] bg-transparent text-[#8c877d] transition hover:text-[#f7f7f4]"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "展开最近项目" : "收起最近项目"}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
          <button
            type="button"
            className={
              "mb-3 flex h-9 items-center rounded-lg text-sm font-medium text-[#d8d3c8] transition hover:bg-[#11110f] hover:text-[#f54e00] " +
              (collapsed ? "mx-auto w-9 justify-center" : "w-full gap-2 px-2")
            }
            onClick={() => setComposerResetSignal((value) => value + 1)}
            aria-label="新会话"
          >
            <Plus size={16} />
            {!collapsed && <span>新会话</span>}
          </button>

          {!collapsed && <div className="px-2 pb-1 text-[11px] font-medium text-[#6f6a60]">最近项目</div>}
          <div className="grid gap-1">
            {loadingProjects ? (
              [0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={
                    (collapsed ? "mx-auto h-9 w-9" : "h-[52px] w-full") +
                    " animate-pulse rounded-lg bg-[#11110f]"
                  }
                />
              ))
            ) : visibleProjects.length ? (
              visibleProjects.map((project, index) => (
                <button
                  key={project.id}
                  type="button"
                  className={
                    "grid rounded-lg text-left text-[#f7f7f4] transition hover:bg-[#11110f] " +
                    (collapsed ? "mx-auto h-9 w-9 place-items-center p-0" : "w-full grid-cols-[28px_minmax(0,1fr)] gap-2 px-2 py-2")
                  }
                  onClick={() => router.push(`/p/${project.id}`)}
                  title={project.title}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-md border border-[#24231f] bg-[#0b0b0a] text-[#f54e00]">
                    {index % 3 === 0 ? <PanelsTopLeft size={14} /> : index % 3 === 1 ? <FileText size={14} /> : <Code2 size={14} />}
                  </span>
                  {!collapsed && (
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{project.title}</span>
                      <span className="mt-0.5 block text-[12px] text-[#807a70]">{formatTime(project.updatedAt ?? project.createdAt)}</span>
                    </span>
                  )}
                </button>
              ))
            ) : (
              !collapsed && <div className="px-2 py-3 text-[12px] text-[#807a70]">还没有历史项目。</div>
            )}
          </div>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-14 flex-none items-center justify-between gap-4 border-b border-[#24231f] bg-[#050505] px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-lg border border-[#24231f] bg-[#0b0b0a] text-[#b8b2a6] md:hidden"
              aria-label="打开最近项目"
            >
              <Menu size={16} />
            </button>
          </div>
          <nav className="flex flex-none items-center gap-1.5" aria-label="主导航">
            <Link className="rounded-lg px-3 py-2 text-[13px] text-[#b8b2a6] transition hover:bg-[#11110f] hover:text-[#f54e00]" href="/showcase">
              案例
            </Link>
            <a
              className="hidden items-center gap-1 rounded-lg px-3 py-2 text-[13px] text-[#b8b2a6] transition hover:bg-[#11110f] hover:text-[#f54e00] sm:inline-flex"
              href="https://github.com/siuming-qiu/web-cursor"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} /> GitHub
            </a>
            <Link className="hidden rounded-lg px-3 py-2 text-[13px] text-[#b8b2a6] transition hover:bg-[#11110f] hover:text-[#f54e00] sm:inline-flex" href="/about">
              文档
            </Link>
            <div
              className="relative"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setLocaleOpen(false);
                }
              }}
            >
              <button
                type="button"
                className="inline-flex h-8 min-w-[58px] items-center justify-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-[#b8b2a6] transition hover:bg-[#11110f] hover:text-[#f54e00] focus:bg-[#11110f] focus:outline-none"
                aria-haspopup="menu"
                aria-expanded={localeOpen}
                title={common("language")}
                onClick={() => setLocaleOpen((open) => !open)}
              >
                {currentLocaleLabel}
                <ChevronDown size={14} strokeWidth={2} className={"transition " + (localeOpen ? "rotate-180" : "")} />
              </button>

              {localeOpen && (
                <div
                  className="absolute right-0 top-[calc(100%+8px)] z-30 w-[148px] overflow-hidden rounded-xl border border-[#24231f] bg-[#0b0b0a] p-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.5)]"
                  role="menu"
                >
                  {languageOptions.map((option) => {
                    const active = option.value === locale;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={
                          "flex h-9 w-full items-center justify-between rounded-lg px-3 text-left text-[13px] transition " +
                          (active ? "bg-[#11110f] text-[#f7f7f4]" : "text-[#8c877d] hover:bg-[#11110f] hover:text-[#f7f7f4]")
                        }
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => switchLocale(option.value)}
                      >
                        <span>{option.label}</span>
                        {active && <Check size={15} strokeWidth={2} className="text-[#f54e00]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </nav>
        </header>

        <section className="min-h-0 flex-1 overflow-y-auto px-4 md:px-8">
          <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-[780px] flex-col pt-[18vh]">
            <div className="mb-5 text-center">
              <h1 className="text-[30px] font-semibold leading-tight tracking-normal text-[#f7f7f4] md:text-[38px]">你想做什么？</h1>
            </div>

            <Composer
              busy={false}
              onSend={startGeneration}
              onStop={() => undefined}
              containerClassName=""
              boxClassName="rounded-[22px] border border-[#2d2a24] bg-[#0b0b0a] p-3 shadow-[0_18px_70px_rgba(0,0,0,0.28)] transition focus-within:border-[#5a3a28]"
              textareaClassName="min-h-[92px] w-full resize-none border-0 bg-transparent px-2 py-2 text-[16px] leading-7 text-[#f7f7f4] outline-none placeholder:text-[#6f6a60]"
              footerClassName="flex items-center justify-between gap-3 px-1 pt-2"
              submitLabel="生成"
              resetSignal={composerResetSignal}
              submitButtonClassName={(canSend) =>
                "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition disabled:cursor-not-allowed " +
                (canSend ? "bg-[#f54e00] text-white hover:bg-[#d94300]" : "bg-[#171511] text-[#6f6a60]")
              }
            />

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {suggestions.map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  className="max-w-[220px] truncate rounded-full border border-[#24231f] bg-[#080807] px-3 py-1.5 text-[12px] text-[#9b9489] transition hover:border-[#3b372f] hover:bg-[#11110f] hover:text-[#f7f7f4]"
                  onClick={() => startGeneration(item.prompt)}
                  title={item.prompt}
                >
                  {item.label}
                </button>
              ))}
              <Link className="rounded-full px-3 py-1.5 text-[12px] text-[#807a70] transition hover:bg-[#11110f] hover:text-[#f54e00]" href="/showcase">
                查看案例
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
