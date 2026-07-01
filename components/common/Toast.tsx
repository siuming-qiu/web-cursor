"use client";

export default function Toast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-panel2 border border-border rounded-[10px] px-[18px] py-[11px] text-[13px] z-[60] shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
      {message}
    </div>
  );
}
