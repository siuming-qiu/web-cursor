"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import type { PreviewRunPhase } from "@/hooks/usePreview";
import type { WorkbenchViewMode } from "@/lib/workbenchStore";

const btn =
  "px-3 py-1.5 rounded-lg text-[13px] inline-flex items-center gap-1.5 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const btnGhost = `${btn} bg-panel2 border-border text-fg hover:border-accent hover:bg-[#171714]`;
const modeBtn =
  "inline-flex h-8 items-center justify-center gap-2 rounded-full px-5 text-[13px] font-medium transition-colors";

export default function TopBar({
  projName,
  canAct,
  viewMode,
  previewRunPhase = "idle",
  previewHasUpdate = false,
  onViewModeChange,
  onHome,
  onRerun,
}: {
  projName: string;
  canAct: boolean;
  viewMode?: WorkbenchViewMode;
  previewRunPhase?: PreviewRunPhase;
  previewHasUpdate?: boolean;
  onViewModeChange?: (mode: WorkbenchViewMode) => void;
  onHome?: () => void;
  onRerun?: () => void;
}) {
  const t = useTranslations("TopBar");
  const common = useTranslations("Common");
  const locale = useLocale();
  const [localeOpen, setLocaleOpen] = useState(false);
  const showModeSwitch = viewMode && onViewModeChange;
  const previewRefreshing = previewRunPhase !== "idle";
  const previewNotified = !previewRefreshing && previewHasUpdate;
  const currentLocaleLabel = locale === "en" ? "EN" : "中";
  const languageOptions = [
    { value: "en" as const, label: common("english"), shortLabel: "EN" },
    { value: "zh" as const, label: common("chinese"), shortLabel: "中" },
  ];

  function switchLocale(nextLocale: "zh" | "en") {
    setLocaleOpen(false);
    if (nextLocale === locale) return;
    document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; SameSite=Lax`;
    window.location.reload();
  }

  return (
    <div className="h-12 flex-none flex items-center gap-3 px-4 bg-panel border-b border-border">
      <div className="font-semibold tracking-wide flex items-center gap-[7px]">
        <span className="w-[9px] h-[9px] rounded-full bg-accent shadow-[0_0_14px_rgba(245,78,0,0.55)]" />
        Web Cursor
      </div>
      <span className="text-muted text-[13px]">
        {onHome && (
          <button
            className="mr-2 px-2 py-1 rounded-md text-accent hover:bg-panel2"
            onClick={onHome}
          >
            {common("myProjects")}
          </button>
        )}
        · <b className="text-fg font-medium">{projName}</b>
      </span>
      <div className="flex-1" />
      {showModeSwitch && (
        <div className="flex items-center gap-1 rounded-full border border-border bg-[#050505] p-1">
          <button
            className={
              modeBtn +
              " " +
              (viewMode === "preview" ? "bg-[#1b1713] text-accent shadow-inner" : "text-muted hover:text-fg")
            }
            type="button"
            onClick={() => onViewModeChange("preview")}
          >
            <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center">
              {previewRefreshing && (
                <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-accent opacity-60" />
              )}
              <span
                className={
                  "relative h-2 w-2 rounded-full border transition-all " +
                  (previewRefreshing
                    ? "border-accent bg-accent shadow-[0_0_12px_rgba(245,78,0,0.55)]"
                      : previewNotified
                      ? "border-accent bg-accent shadow-[0_0_10px_rgba(245,78,0,0.55)]"
                    : viewMode === "preview"
                      ? "border-accent bg-accent/70"
                      : "border-muted bg-transparent")
                }
              />
            </span>
            {t("preview")}
          </button>
          <button
            className={
              modeBtn +
              " " +
              (viewMode === "code" ? "bg-[#1b1a17] text-fg shadow-inner" : "text-muted hover:text-fg")
            }
            type="button"
            onClick={() => onViewModeChange("code")}
          >
            ⌘ {t("code")}
          </button>
        </div>
      )}
      <div className="flex-1" />
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
          className="inline-flex h-8 min-w-[74px] items-center justify-center gap-1.5 rounded-full border border-border bg-codebg px-3 text-[13px] font-semibold text-fg transition hover:border-accent focus:border-accent focus:outline-none"
          aria-haspopup="menu"
          aria-expanded={localeOpen}
          title={common("language")}
          onClick={() => setLocaleOpen((open) => !open)}
        >
          {currentLocaleLabel}
          <ChevronDown
            size={15}
            strokeWidth={2}
            className={"text-muted transition " + (localeOpen ? "rotate-180" : "")}
          />
        </button>

        {localeOpen && (
          <div
            className="absolute right-0 top-[calc(100%+8px)] z-30 w-[156px] overflow-hidden rounded-xl border border-border bg-panel p-1.5 shadow-[0_16px_34px_rgba(0,0,0,0.42)]"
            role="menu"
          >
            {languageOptions.map((option) => {
              const active = option.value === locale;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={
                    "flex h-10 w-full items-center justify-between rounded-lg px-3 text-left text-[13px] transition " +
                    (active ? "bg-panel2 text-fg" : "text-muted hover:bg-panel2 hover:text-fg")
                  }
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => switchLocale(option.value)}
                >
                  <span>{option.label}</span>
                  {active && <Check size={16} strokeWidth={2} className="text-accent" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {onRerun && (
        <button className={btnGhost} disabled={!canAct} onClick={onRerun}>
          ↻ {t("rerun")}
        </button>
      )}
    </div>
  );
}
