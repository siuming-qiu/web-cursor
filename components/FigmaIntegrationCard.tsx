/**
 * [INPUT]: Optional returnTo + resume/log callbacks
 * [OUTPUT]: A reusable integration card that owns Figma OAuth status/connect/disconnect flow
 * [POS]: B 域 Figma 授权卡片 —— 展示当前连接状态，不持有 token
 * [PROTOCOL]: 连接事实只来自 /api/integrations/figma/status；页面不应自己复制 status/OAuth 流程
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Boxes, CheckCircle2, Link2, Loader2, RefreshCw, Wand2, XCircle } from "lucide-react";
import { req } from "@/lib/api";
import { getOwnerId } from "@/lib/owner";

export type FigmaConnectionStatus =
  | { status: "loading" }
  | { status: "disconnected" }
  | { status: "connected"; figmaUserId: string; scopes: string[]; expiresAt: string | null }
  | { status: "error"; message: string };

type ServerFigmaStatus =
  | { status: "connected"; figmaUserId: string; scopes: string[]; expiresAt: string | null }
  | { status: "disconnected" };

type Props = {
  returnTo?: string;
  onResume?: () => void;
  onLog?: (message: string) => void;
};

const buttonBase =
  "inline-flex h-8 items-center justify-center gap-2 rounded-md border px-3 text-[12.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = `${buttonBase} border-[#f24e1e] bg-[#f24e1e] text-white hover:bg-[#d94419]`;
const quietButton = `${buttonBase} border-[#34312b] bg-[#151412] text-[#f7f3ea] hover:border-[#5d554a]`;
const OAUTH_CALLBACK_MESSAGE_TYPE = "WEB_CURSOR_FIGMA_OAUTH_CALLBACK";

function statusCopy(status: FigmaConnectionStatus, t: ReturnType<typeof useTranslations<"Figma">>) {
  if (status.status === "loading") {
    return {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      label: t("checking"),
      title: t("checkingTitle"),
      detail: t("checkingDetail"),
    };
  }
  if (status.status === "connected") {
    return {
      icon: <CheckCircle2 className="h-4 w-4" />,
      label: t("connected"),
      title: t("connectedTitle"),
      detail: t("connectedDetail"),
    };
  }
  if (status.status === "error") {
    return {
      icon: <XCircle className="h-4 w-4" />,
      label: t("error"),
      title: t("errorTitle"),
      detail: status.message,
    };
  }
  return {
    icon: <Link2 className="h-4 w-4" />,
    label: t("disconnected"),
    title: t("disconnectedTitle"),
    detail: t("disconnectedDetail"),
  };
}

function toCardStatus(status: ServerFigmaStatus): FigmaConnectionStatus {
  return status.status === "connected" ? status : { status: "disconnected" };
}

function currentReturnTo() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
}

function isOAuthCallbackMessage(value: unknown): value is { type: typeof OAUTH_CALLBACK_MESSAGE_TYPE; status: "success" | "error"; code?: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.type === OAUTH_CALLBACK_MESSAGE_TYPE
    && (record.status === "success" || record.status === "error")
    && (record.code === undefined || typeof record.code === "string");
}

export default function FigmaIntegrationCard({
  returnTo,
  onResume,
  onLog,
}: Props) {
  const t = useTranslations("Figma");
  const [status, setStatus] = useState<FigmaConnectionStatus>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const copy = statusCopy(status, t);
  const connected = status.status === "connected";
  const [popupBusy, setPopupBusy] = useState(false);
  const [popupError, setPopupError] = useState("");
  const popupRef = useRef<Window | null>(null);
  const effectiveBusy = busy || popupBusy;

  const log = useCallback((message: string) => {
    onLog?.(message);
  }, [onLog]);

  const refreshStatus = useCallback(async () => {
    setStatus({ status: "loading" });
    try {
      const next = await req<ServerFigmaStatus>("GET", "/api/integrations/figma/status");
      setStatus(toCardStatus(next));
      log(`status -> ${next.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ status: "error", message });
      log(`status error -> ${message}`);
    }
  }, [log]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const connectUrl = useCallback(() => {
    const params = new URLSearchParams({
      ownerId: getOwnerId(),
      returnTo: returnTo ?? currentReturnTo(),
    });
    return `/api/integrations/figma/oauth/start?${params.toString()}`;
  }, [returnTo]);

  const openConnectPopup = useCallback(() => {
    setPopupError("");
    log("popup -> Figma OAuth start");
    const popup = window.open(connectUrl(), "web-cursor-figma-oauth", "popup=yes,width=720,height=760");
    popupRef.current = popup;
    if (!popup) {
      setPopupBusy(false);
      setPopupError(t("popupBlocked"));
      log("popup blocked");
      return;
    }
    setPopupBusy(true);
    popup.focus();
  }, [connectUrl, log, t]);

  useEffect(() => {
    if (!popupBusy) return;
    const timer = window.setInterval(() => {
      const popup = popupRef.current;
      if (popup?.closed) {
        popupRef.current = null;
        setPopupBusy(false);
        log("popup closed -> refresh status");
        refreshStatus();
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [log, popupBusy, refreshStatus]);

  useEffect(() => {
    const onFocus = () => {
      if (popupRef.current) {
        log("window focus -> refresh status");
        refreshStatus();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [log, refreshStatus]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      if (!isOAuthCallbackMessage(event.data)) return;

      popupRef.current = null;
      setPopupBusy(false);

      if (event.data.status === "success") {
        setPopupError("");
        log("popup callback -> success");
        refreshStatus();
        return;
      }

      const code = event.data.code ? ` (${event.data.code})` : "";
      setPopupError(`Figma OAuth failed${code}.`);
      log(`popup callback -> error${code}`);
      refreshStatus();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [log, refreshStatus]);

  return (
    <section className="w-full max-w-[620px] overflow-hidden rounded-xl border border-[#3b342c] bg-[#11100e] text-[#f7f3ea]">
      <div className="flex items-start gap-3 border-b border-[#2b261f] bg-[#15130f] px-4 py-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-[#3b342c] bg-[#0a0908] text-[#f24e1e]">
          <Boxes className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 leading-none">
            <h2 className="m-0 text-[15px] font-semibold leading-5">{copy.title}</h2>
            <span className="inline-flex h-5 items-center gap-1.5 rounded-full border border-[#3b362f] bg-[#1b1814] px-2 text-[10.5px] text-[#c7bfb2]">
              {copy.icon}
              {copy.label}
            </span>
          </div>
          <p className="m-0 max-w-[48ch] break-words text-[12.5px] leading-5 text-[#aaa195]">{copy.detail}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {(status.status === "disconnected" || popupError) && (
          <button className={primaryButton} type="button" disabled={effectiveBusy} onClick={openConnectPopup}>
            {effectiveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {t("connect")}
          </button>
        )}
        {connected && (
          onResume && (
            <button className={primaryButton} type="button" disabled={effectiveBusy} onClick={onResume}>
              <Wand2 className="h-4 w-4" />
              {t("resume")}
            </button>
          )
        )}
        {status.status === "error" && (
          <button className={quietButton} type="button" disabled={effectiveBusy} onClick={refreshStatus}>
            <RefreshCw className="h-4 w-4" />
            {t("refresh")}
          </button>
        )}
      </div>
      {popupError && (
        <div className="border-t border-[#2b261f] px-4 pb-3 text-[12px] leading-5 text-[#ffb8aa]">
          {popupError}
        </div>
      )}
    </section>
  );
}
