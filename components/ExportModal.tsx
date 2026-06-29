"use client";

import { useState } from "react";

export default function ExportModal({
  onBuildHtml,
  onClose,
  onToast,
}: {
  onBuildHtml: () => Promise<string>;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
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
      onToast("✓ 已导出 " + a.download);
    } catch (e: any) {
      onToast("导出失败：" + (e?.message ?? e));
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[430px] bg-panel border border-border rounded-[14px] overflow-hidden">
        <div className="flex items-center justify-between px-[18px] py-[15px] border-b border-border font-semibold">
          导出为静态 HTML
            <button className="bg-none border-none text-muted text-lg hover:text-accent" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-[18px] leading-[1.7]">
          <div className="text-muted text-[13px] mb-4">
            把当前结果导出成一个 .html 文件，在浏览器打开即可运行（依赖走 esm.sh CDN）。
          </div>
          <div className="mb-4">
            <label className="block text-[12px] text-muted mb-1.5">文件名</label>
            <input
              type="text"
              value={fname}
              onChange={(e) => setFname(e.target.value)}
              className="w-full bg-codebg border border-border rounded-lg text-fg px-[11px] py-2 font-mono text-[13px]"
            />
          </div>
          <div className="mb-4">
            <label className="block text-[12px] text-muted mb-1.5">依赖方式</label>
            <label className="flex gap-[9px] items-start px-[11px] py-[9px] border border-accent rounded-[9px] mb-2 bg-accent/[0.07] cursor-pointer">
              <input type="radio" name="dep" defaultChecked className="mt-[3px]" />
              <div>
                <div className="text-[13.5px]">
                  联网运行 <span className="text-[10px] bg-panel2 border border-border rounded px-1.5 py-px text-muted ml-1.5">一期默认</span>
                </div>
                <div className="text-[11.5px] text-muted mt-0.5">体积小，依赖走 CDN，打开需联网</div>
              </div>
            </label>
            <label className="flex gap-[9px] items-start px-[11px] py-[9px] border border-border rounded-[9px] opacity-50 cursor-not-allowed">
              <input type="radio" name="dep" disabled className="mt-[3px]" />
              <div>
                <div className="text-[13.5px]">
                  完全离线 <span className="text-[10px] bg-panel2 border border-border rounded px-1.5 py-px text-muted ml-1.5">🔒 二期</span>
                </div>
                <div className="text-[11.5px] text-muted mt-0.5">依赖内联，断网也能 file:// 双击运行</div>
              </div>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2.5 px-[18px] py-[14px] border-t border-border">
          <button
            className="px-3 py-1.5 rounded-md text-[13px] bg-panel2 border border-border text-fg hover:border-accent"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="px-3.5 py-1.5 rounded-md text-[13px] bg-accent border border-accent text-white font-medium hover:bg-[#d04200]"
            onClick={download}
          >
            ⬇ 下载 HTML
          </button>
        </div>
      </div>
    </div>
  );
}
