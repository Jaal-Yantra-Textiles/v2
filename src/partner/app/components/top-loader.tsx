"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"

/**
 * Lightweight indeterminate top loader for App Router.
 * Shows a thin animated bar at the top during route changes.
 */
export default function TopLoader() {
  const pathname = usePathname()
  const search = useSearchParams()
  const [visible, setVisible] = useState(false)
  const hideTimeout = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // On path or query change, show the bar immediately
    setVisible(true)

    // Hide after a short delay — adjust to your network characteristics
    if (hideTimeout.current) clearTimeout(hideTimeout.current)
    hideTimeout.current = setTimeout(() => setVisible(false), 800)

    return () => {
      if (hideTimeout.current) {
        clearTimeout(hideTimeout.current)
        hideTimeout.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search?.toString()])

  if (!visible) return null

  return (
    <div className="fixed inset-x-0 top-0 z-[11000] h-0.5 overflow-hidden">
      <div className="h-full bg-ui-fg-interactive animate-[loader-slide_1.2s_ease-in-out_infinite]" />
      <style jsx>{`
        @keyframes loader-slide {
          0% { transform: translateX(-100%); width: 20%; }
          50% { transform: translateX(20%); width: 60%; }
          100% { transform: translateX(100%); width: 20%; }
        }
      `}</style>
    </div>
  )
}
