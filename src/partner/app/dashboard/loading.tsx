export default function DashboardLoading() {
  return (
    <div className="relative h-full w-full">
      {/* Thin top pulse bar for quick feedback */}
      <div className="fixed inset-x-0 top-0 z-[11000] h-1 overflow-hidden">
        <div className="h-full w-1/3 bg-ui-fg-interactive animate-pulse" />
      </div>
      {/* Content-area spinner (renders where page content goes, right of sidebar) */}
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex items-center gap-3 rounded-md border bg-white/90 dark:bg-zinc-900/90 px-4 py-3 shadow-sm">
          <span
            className="inline-block size-5 rounded-full border-2 border-transparent border-t-current animate-spin"
            aria-hidden="true"
          />
          <span className="text-sm text-ui-fg-base">Loading…</span>
        </div>
      </div>
    </div>
  )
}
