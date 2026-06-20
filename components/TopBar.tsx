"use client";

const btn =
  "px-3 py-1.5 rounded-md text-[13px] inline-flex items-center gap-1.5 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const btnGhost = `${btn} bg-panel2 border-border text-fg hover:border-accent hover:bg-[#222b39]`;
const btnPrimary = `${btn} bg-accent border-accent text-[#04101f] font-semibold hover:bg-[#79b8ff]`;

export default function TopBar({
  projName,
  canAct,
  onRerun,
  onExport,
}: {
  projName: string;
  canAct: boolean;
  onRerun: () => void;
  onExport: () => void;
}) {
  return (
    <div className="h-12 flex-none flex items-center gap-3 px-4 bg-panel border-b border-border">
      <div className="font-bold tracking-wide flex items-center gap-[7px]">
        <span className="w-[9px] h-[9px] rounded-full bg-accent shadow-[0_0_10px_#58a6ff]" />
        Web Cursor
      </div>
      <span className="text-muted text-[13px]">
        · <b className="text-fg font-medium">{projName}</b>
      </span>
      <div className="flex-1" />
      <button className={btnGhost} disabled={!canAct} onClick={onRerun}>
        ↻ 重跑
      </button>
      <button className={btnPrimary} disabled={!canAct} onClick={onExport}>
        ⬇ 导出 HTML
      </button>
    </div>
  );
}
