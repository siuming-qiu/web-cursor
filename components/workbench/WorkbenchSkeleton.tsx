export default function WorkbenchSkeleton() {
  return (
    <main className="flex-1 flex min-h-0">
      <div className="flex h-full w-[380px] flex-none flex-col border-r border-border bg-panel">
        <div className="h-9 border-b border-border px-[14px] flex items-center">
          <div className="h-3 w-20 rounded bg-panel2 animate-pulse" />
        </div>
        <div className="border-b border-border p-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mb-1.5 flex items-center gap-2 rounded-md px-2.5 py-2">
              <div className="h-6 w-6 rounded-md bg-panel2 animate-pulse" />
              <div className="min-w-0 flex-1">
                <div className="h-3 w-28 rounded bg-panel2 animate-pulse" />
                <div className="mt-2 h-2.5 w-20 rounded bg-panel2 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex-1 p-4">
          <div className="h-4 w-40 rounded bg-panel2 animate-pulse" />
          <div className="mt-4 h-16 rounded-lg bg-panel2 animate-pulse" />
          <div className="mt-3 h-12 rounded-lg bg-panel2 animate-pulse" />
        </div>
      </div>
      <div className="flex-[1.05] border-r border-border bg-codebg">
        <div className="h-9 border-b border-border px-[14px] flex items-center">
          <div className="h-3 w-20 rounded bg-panel2 animate-pulse" />
        </div>
        <div className="p-6">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="mb-3 h-3 rounded bg-panel2 animate-pulse" style={{ width: `${80 - i * 7}%` }} />
          ))}
        </div>
      </div>
      <div className="flex-1 bg-panel">
        <div className="h-9 border-b border-border px-[14px] flex items-center">
          <div className="h-3 w-20 rounded bg-panel2 animate-pulse" />
        </div>
        <div className="h-[34px] border-b border-border px-[14px] flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-panel2 animate-pulse" />
          <div className="h-3 w-28 rounded bg-panel2 animate-pulse" />
        </div>
        <div className="flex h-[calc(100%-70px)] items-center justify-center">
          <div className="h-20 w-20 rounded-2xl border border-dashed border-border bg-panel2/40 animate-pulse" />
        </div>
      </div>
    </main>
  );
}
