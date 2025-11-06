"use client"

import { PropsWithChildren } from "react"

export default function ActionFooter({ children }: PropsWithChildren) {
  // Uses CSS var --sidebar-width if your layout sets it; falls back to 0
  return (
    <div
      className="fixed bottom-0 right-0 z-30"
      style={{ left: "var(--sidebar-width, 0px)" }}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-2">
        <div className="flex items-center justify-end gap-2 rounded-md border border-ui-border-base bg-ui-bg-base/90 backdrop-blur px-4 py-2 shadow-lg">
          {children}
        </div>
      </div>
    </div>
  )
}
