"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";

const OAuthCallbackStatus = {
  Success: "success",
  Error: "error",
} as const;

type OAuthCallbackStatus = typeof OAuthCallbackStatus[keyof typeof OAuthCallbackStatus];

const OAUTH_CALLBACK_MESSAGE_TYPE = "WEB_CURSOR_FIGMA_OAUTH_CALLBACK";

type Props = {
  status: OAuthCallbackStatus;
  returnTo: string;
  code: string;
  message: string;
};

export default function CallbackClient({ status, returnTo, code, message }: Props) {
  const t = useTranslations("FigmaCallback");
  const [closing, setClosing] = useState(status === OAuthCallbackStatus.Success);
  const success = status === OAuthCallbackStatus.Success;

  const targetPath = useMemo(() => {
    if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return "/";
    return returnTo;
  }, [returnTo]);

  useEffect(() => {
    window.opener?.postMessage(
      {
        type: OAUTH_CALLBACK_MESSAGE_TYPE,
        status,
        code,
      },
      window.location.origin,
    );

    if (!success) {
      setClosing(false);
      return;
    }

    const timer = window.setTimeout(() => {
      window.close();
      setClosing(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [code, status, success]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070706] px-5 text-[#f7f3ea]">
      <section className="w-full max-w-[460px] rounded-2xl border border-[#302d27] bg-[#11100e] p-6 shadow-[0_22px_54px_rgba(0,0,0,0.42)]">
        <div className="mb-5 flex items-center gap-3">
          <div className={
            "flex h-11 w-11 items-center justify-center rounded-xl border " +
            (success ? "border-green/40 bg-green/10 text-green" : "border-red/40 bg-red/10 text-red")
          }>
            {success ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
          </div>
          <div>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f24e1e]">
              Figma OAuth
            </div>
            <h1 className="m-0 text-[20px] font-semibold leading-7">
              {success ? t("successTitle") : t("errorTitle")}
            </h1>
          </div>
        </div>

        <p className="m-0 text-[13px] leading-6 text-[#b8afa3]">
          {success ? t("successDescription") : message || t("errorDescription")}
        </p>

        {!success && code && (
          <div className="mt-4 rounded-lg border border-[#34312b] bg-[#0a0908] px-3 py-2 font-mono text-[12px] text-[#ffb8aa]">
            {code}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {closing ? (
            <span className="inline-flex h-9 items-center gap-2 rounded-md border border-[#34312b] bg-[#151412] px-3 text-[13px] text-[#d9d1c4]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("closing")}
            </span>
          ) : (
            <button
              className="inline-flex h-9 items-center rounded-md border border-[#34312b] bg-[#151412] px-3 text-[13px] text-[#f7f3ea] transition hover:border-[#5d554a]"
              type="button"
              onClick={() => window.close()}
            >
              {t("closeWindow")}
            </button>
          )}
          <Link
            className="inline-flex h-9 items-center rounded-md border border-[#f24e1e] bg-[#f24e1e] px-3 text-[13px] font-semibold text-white transition hover:bg-[#d94419]"
            href={targetPath}
          >
            {t("backToApp")}
          </Link>
        </div>
      </section>
    </main>
  );
}
