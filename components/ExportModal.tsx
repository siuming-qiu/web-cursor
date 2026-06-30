"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export default function ExportModal({
  onBuildHtml,
  onClose,
  onToast,
}: {
  onBuildHtml: () => Promise<string>;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const t = useTranslations("Export");
  const common = useTranslations("Common");
  const [fname, setFname] = useState("my-app.html");

  async function download() {
    try {
      const html = await onBuildHtml();
      const blob = new Blob([html], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname || "app.html";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      onClose();
      onToast("✓ " + t("exported", { file: a.download }));
    } catch (e: any) {
      onToast(t("failed", { message: e?.message ?? e }));
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[430px] bg-panel border border-border rounded-[14px] overflow-hidden">
        <div className="flex items-center justify-between px-[18px] py-[15px] border-b border-border font-semibold">
          {t("title")}
            <button className="bg-none border-none text-muted text-lg hover:text-accent" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-[18px] leading-[1.7]">
          <div className="text-muted text-[13px] mb-4">
            {t("description")}
          </div>
          <div className="mb-4">
            <label className="block text-[12px] text-muted mb-1.5">{t("fileName")}</label>
            <input
              type="text"
              value={fname}
              onChange={(e) => setFname(e.target.value)}
              className="w-full bg-codebg border border-border rounded-lg text-fg px-[11px] py-2 font-mono text-[13px]"
            />
          </div>
          <div className="mb-4">
            <label className="block text-[12px] text-muted mb-1.5">{t("dependencyMode")}</label>
            <label className="flex gap-[9px] items-start px-[11px] py-[9px] border border-accent rounded-[9px] mb-2 bg-accent/[0.07] cursor-pointer">
              <input type="radio" name="dep" defaultChecked className="mt-[3px]" />
              <div>
                <div className="text-[13.5px]">
                  {t("online")} <span className="text-[10px] bg-panel2 border border-border rounded px-1.5 py-px text-muted ml-1.5">{t("defaultBadge")}</span>
                </div>
                <div className="text-[11.5px] text-muted mt-0.5">{t("onlineDescription")}</div>
              </div>
            </label>
            <label className="flex gap-[9px] items-start px-[11px] py-[9px] border border-border rounded-[9px] opacity-50 cursor-not-allowed">
              <input type="radio" name="dep" disabled className="mt-[3px]" />
              <div>
                <div className="text-[13.5px]">
                  {t("offline")} <span className="text-[10px] bg-panel2 border border-border rounded px-1.5 py-px text-muted ml-1.5">{t("futureBadge")}</span>
                </div>
                <div className="text-[11.5px] text-muted mt-0.5">{t("offlineDescription")}</div>
              </div>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2.5 px-[18px] py-[14px] border-t border-border">
          <button
            className="px-3 py-1.5 rounded-md text-[13px] bg-panel2 border border-border text-fg hover:border-accent"
            onClick={onClose}
          >
            {common("cancel")}
          </button>
          <button
            className="px-3.5 py-1.5 rounded-md text-[13px] bg-accent border border-accent text-white font-medium hover:bg-[#d04200]"
            onClick={download}
          >
            ⬇ {t("download")}
          </button>
        </div>
      </div>
    </div>
  );
}
