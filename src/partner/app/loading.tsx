
export default function GlobalLoading() {
  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-[rgb(250,250,250)]/80 dark:bg-black/60">
      <div className="flex items-center gap-3 rounded-md border bg-white/90 dark:bg-zinc-900/90 px-4 py-3 shadow-sm">
        <span
          className="inline-block size-5 rounded-full border-2 border-transparent border-t-current animate-spin"
          aria-hidden="true"
        />
        <span className="text-sm text-ui-fg-base">Loading…</span>
      </div>
    </div>
  )
}
