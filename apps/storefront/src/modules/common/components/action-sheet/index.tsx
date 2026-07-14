"use client"

import { useEffect, useRef, useState } from "react"

type ActionSheetProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
}

export default function ActionSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: ActionSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open) {
      setVisible(true)
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
      const t = setTimeout(() => setVisible(false), 300)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!mounted || !visible) return null

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end">
      <div
        className={`absolute inset-0 bg-ui-bg-overlay transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <div
        ref={sheetRef}
        className={`relative w-full max-h-[88vh] bg-ui-bg-base rounded-t-2xl shadow-elevation-modal border-t border-ui-border-base flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-ui-border-base" />
        </div>

        {title && (
          <div className="flex items-center justify-between px-6 pt-2 pb-3 flex-shrink-0">
            <h2 className="text-lg font-medium text-ui-fg-base">{title}</h2>
            <button
              onClick={onClose}
              className="text-ui-fg-subtle hover:text-ui-fg-base transition-colors p-1 -mr-1"
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 pb-4">{children}</div>

        {footer && (
          <div className="flex-shrink-0 border-t border-ui-border-base px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
