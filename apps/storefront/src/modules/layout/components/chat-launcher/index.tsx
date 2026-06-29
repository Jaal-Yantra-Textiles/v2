"use client"

import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { useEffect, useState } from "react"

import {
  CONCIERGE_THREAD_EVENT,
  hasConciergeThread,
} from "@lib/util/concierge-thread"

/**
 * Floating concierge launcher — the persistent way back into the chat
 * once the visitor has left the `/chat` route. Mounted once in the
 * (main) layout so it rides along every storefront page except the
 * chat page itself (where it would be redundant) and checkout (a
 * separate route group that never renders it).
 *
 * When a saved conversation exists in localStorage it shows a small
 * "active thread" dot, inviting the visitor to resume. The dot state is
 * read on mount (localStorage is client-only, so we start `false` to
 * match SSR and update after hydration) and kept live via the
 * concierge-thread change event + cross-tab `storage` events.
 */
export default function ChatLauncher() {
  const pathname = usePathname()
  const { countryCode } = useParams()
  const [hasThread, setHasThread] = useState(false)

  useEffect(() => {
    const sync = () => setHasThread(hasConciergeThread())
    sync()
    window.addEventListener(CONCIERGE_THREAD_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(CONCIERGE_THREAD_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  // Don't render on the chat page itself.
  if (pathname?.endsWith("/chat")) return null

  const href = countryCode ? `/${countryCode}/chat` : "/chat"

  return (
    <Link
      href={href}
      aria-label={
        hasThread
          ? "Resume your Cici concierge chat"
          : "Open the Cici concierge chat"
      }
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-ui-border-base bg-ui-bg-base text-ui-fg-base shadow-elevation-flyout transition hover:bg-ui-bg-base-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-border-interactive"
    >
      <ChatGlyph />
      {hasThread && (
        <span
          aria-hidden
          className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-ui-bg-interactive ring-2 ring-ui-bg-base"
        />
      )}
    </Link>
  )
}

const ChatGlyph = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.1A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" />
  </svg>
)
