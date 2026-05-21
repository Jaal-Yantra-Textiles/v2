"use client"

import { useRef } from "react"
import AiSearchChat, { type AiSearchChatHandle } from "./index"

/**
 * Search bar that lives in the /store header and pops the AI chat
 * modal on focus/click. Once open, the modal owns the input field;
 * any text typed before the focus event is forwarded as the initial
 * query so the customer never loses a keystroke.
 *
 * Designed to slot into Medusa's standard storefront layout (flex
 * row with the page title on the left, this on the right). On mobile
 * it stacks under the title.
 */
export default function AiSearchTrigger() {
  const chatRef = useRef<AiSearchChatHandle>(null)

  const open = (initialQuery?: string) => {
    chatRef.current?.open(initialQuery)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => open()}
        className="group flex w-full items-center gap-2 rounded-full border border-neutral-300 bg-white px-4 py-2 text-left text-sm text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-700 sm:max-w-sm sm:py-2.5"
        aria-label="Open AI product search"
      >
        <span className="flex-1 truncate">Ask AI to find products…</span>
        <span className="hidden text-[10px] uppercase tracking-wide text-neutral-400 group-hover:text-neutral-500 sm:inline">
          AI
        </span>
      </button>
      <AiSearchChat ref={chatRef} />
    </>
  )
}
