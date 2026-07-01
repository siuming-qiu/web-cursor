/**
 * [INPUT]: Current browser ownerId and Figma integration APIs
 * [OUTPUT]: A dev-only page for manually debugging Figma OAuth card states
 * [POS]: B 域 Figma 调试页 —— 独立验证授权卡片，不接入正式 chat transcript
 * [PROTOCOL]: 只用于开发调试；弹窗授权由 FigmaIntegrationCard 处理，本页只展示 owner 和事件日志
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Copy, Database, ExternalLink, ShieldCheck, Terminal } from "lucide-react";
import Link from "next/link";
import FigmaIntegrationCard from "@/components/integrations/figma/FigmaIntegrationCard";
import { getOwnerId } from "@/lib/owner";

function logLine(message: string) {
  return `${new Date().toLocaleTimeString("zh-CN", { hour12: false })}  ${message}`;
}

export default function FigmaDevPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOwnerId(getOwnerId());
  }, []);

  const pushLog = useCallback((message: string) => {
    setLogs((prev) => [logLine(message), ...prev].slice(0, 8));
  }, []);

  const copyOwner = useCallback(async () => {
    if (!ownerId) return;
    await navigator.clipboard.writeText(ownerId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [ownerId]);

  return (
    <main className="h-screen overflow-y-auto bg-[#070706] text-[#f7f3ea]">
      <div className="border-b border-[#28241f] bg-[#10100e]">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <Link className="inline-flex h-9 items-center gap-2 rounded-md border border-[#34312b] bg-[#151412] px-3 text-[13px] text-[#d9d1c4] transition hover:border-[#5d554a]" href="/">
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </Link>
          <div className="h-5 w-px bg-[#34312b]" />
          <div>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f24e1e]">Dev Console</div>
            <h1 className="m-0 text-[20px] font-semibold leading-7">Figma OAuth Card</h1>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0">
          <div className="mb-4 rounded-lg border border-[#302d27] bg-[#0f0e0c] p-5">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#f7f3ea]">
              <ShieldCheck className="h-4 w-4 text-[#f24e1e]" />
              调试目标
            </div>
            <p className="m-0 max-w-2xl text-[13px] leading-6 text-[#a9a196]">
              这个页面只验证 Figma 授权卡片和后端 OAuth 状态接口。它不会读取 Figma 设计，也不会写入聊天消息。
            </p>
          </div>

          <FigmaIntegrationCard
            returnTo="/dev/figma"
            onResume={() => pushLog("resume clicked -> dev page only")}
            onLog={pushLog}
          />
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-[#302d27] bg-[#0f0e0c] p-4">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              <Database className="h-4 w-4 text-[#f24e1e]" />
              当前 owner
            </div>
            <div className="break-all rounded-md border border-[#34312b] bg-[#151412] p-3 font-mono text-[12px] text-[#d9d1c4]">
              {ownerId || "loading"}
            </div>
            <button className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-[#34312b] bg-[#151412] px-3 text-[12px] text-[#f7f3ea] transition hover:border-[#5d554a]" type="button" onClick={copyOwner}>
              <Copy className="h-3.5 w-3.5" />
              {copied ? "已复制" : "复制 ownerId"}
            </button>
          </section>

          <section className="rounded-lg border border-[#302d27] bg-[#0f0e0c] p-4">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              <ExternalLink className="h-4 w-4 text-[#f24e1e]" />
              OAuth start URL
            </div>
            <div className="break-all rounded-md border border-[#34312b] bg-[#151412] p-3 font-mono text-[11px] leading-5 text-[#d9d1c4]">
              /api/integrations/figma/oauth/start?ownerId={ownerId || "loading"}&returnTo=/dev/figma
            </div>
          </section>

          <section className="rounded-lg border border-[#302d27] bg-[#0f0e0c] p-4">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              <Terminal className="h-4 w-4 text-[#f24e1e]" />
              调试日志
            </div>
            <div className="min-h-[148px] rounded-md border border-[#34312b] bg-[#050505] p-3 font-mono text-[11px] leading-5 text-[#bfb6aa]">
              {logs.length ? logs.map((line) => <div key={line}>{line}</div>) : <div>等待操作...</div>}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
