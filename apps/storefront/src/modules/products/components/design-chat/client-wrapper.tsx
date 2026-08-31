"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"

// Dynamic import to avoid SSR issues (Konva isn't used here, but the chat
// hydrates from localStorage threads — client-only keeps first paint clean
// and matches the dormant editor's wrapper pattern).
const DesignChat = dynamic(() => import("./index"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-ui-bg-subtle">
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-ui-border-base bg-ui-bg-field px-10 py-8 shadow-lg">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-ui-border-base border-t-ui-fg-muted" />
        <span className="text-sm text-ui-fg-subtle">Preparing your design board…</span>
      </div>
    </div>
  ),
})

interface DesignChatWrapperProps {
  product?: {
    id: string
    handle: string
    title: string
    thumbnail?: string | null
    images?: string[]
  } | null
  initialDesign?: {
    id: string
    name?: string
    status?: string
    thumbnail_url?: string | null
    moodboard?: unknown
  } | null
  countryCode: string
}

/**
 * Client wrapper for the chat-based design editor.
 *
 * The customer/email seeding happens inside DesignChat itself
 * (retrieveCustomerFresh on mount — same stale-cache fix as the dormant
 * editor's wrapper). This shell only owns responsive detection and the
 * dynamic import.
 */
export default function DesignChatWrapper({
  product,
  initialDesign,
  countryCode,
}: DesignChatWrapperProps) {
  const [isMobileLayout, setIsMobileLayout] = useState(false)

  useEffect(() => {
    const check = () => setIsMobileLayout(window.innerWidth < 1024)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  return (
    <DesignChat
      product={product}
      initialDesign={initialDesign}
      countryCode={countryCode}
      isMobileLayout={isMobileLayout}
    />
  )
}
