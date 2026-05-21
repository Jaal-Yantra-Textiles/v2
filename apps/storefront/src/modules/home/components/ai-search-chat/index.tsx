"use client"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { searchAiProducts, type AiSearchProduct } from "@lib/data/ai-search"
import {
  clearThread,
  emptyThread,
  loadThread,
  newMessageId,
  saveThread,
  type AiChatMessage,
  type AiChatThread,
} from "@lib/util/ai-chat-thread"
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"

/**
 * Chat-style search modal.
 *
 * Renders as a focused overlay over the /store page. The trigger
 * (see ./trigger.tsx) opens it; closing returns the customer to the
 * underlying list. The conversation is persisted to localStorage via
 * `lib/util/ai-chat-thread.ts` so a quick navigation or reload doesn't
 * lose context.
 *
 * What it does NOT do yet (deferred until the chat thread sync PR):
 *   - server-side persistence on sign-in
 *   - multi-turn refinement (each user turn currently issues an
 *     independent search; the backend doesn't accept prior turns as
 *     context yet)
 */

const PLACEHOLDER = "Describe what you want — e.g. soft cotton dress under 2000"

const formatRelativeTime = (ts: number): string => {
  const seconds = Math.round((Date.now() - ts) / 1000)
  if (seconds < 30) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export type AiSearchChatHandle = {
  open: (initialQuery?: string) => void
  close: () => void
}

const AiSearchChat = forwardRef<AiSearchChatHandle>((_props, ref) => {
  const [open, setOpen] = useState(false)
  const [thread, setThread] = useState<AiChatThread>(() => emptyThread())
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Token that identifies the latest in-flight request. Stale responses
  // are discarded if the user has since typed a new query.
  const inflightRef = useRef<symbol | null>(null)

  // Hydrate the persisted thread on first mount only — open/close cycles
  // should not refetch, otherwise mid-conversation state would jump.
  useEffect(() => {
    setThread(loadThread())
  }, [])

  // Save thread to localStorage whenever it changes, but skip the very
  // first render so we don't pointlessly write the empty thread back.
  const firstRenderRef = useRef(true)
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }
    saveThread(thread)
  }, [thread])

  // Imperative handle so the trigger can open the modal with an
  // already-typed query.
  useImperativeHandle(
    ref,
    () => ({
      open: (initialQuery) => {
        setOpen(true)
        if (initialQuery !== undefined) setInput(initialQuery)
        // Focus on next tick after the input is mounted.
        window.setTimeout(() => inputRef.current?.focus(), 0)
      },
      close: () => setOpen(false),
    }),
    []
  )

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Autoscroll to the bottom of the conversation when messages change.
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [thread.messages.length, loading])

  const submit = useCallback(async () => {
    const trimmed = input.trim()
    if (trimmed.length < 2 || loading) return

    const userMsg: AiChatMessage = {
      id: newMessageId(),
      role: "user",
      content: trimmed,
      ts: Date.now(),
    }
    setThread((t) => ({
      ...t,
      messages: [...t.messages, userMsg],
      updated_at: Date.now(),
    }))
    setInput("")
    setLoading(true)

    const myToken = Symbol()
    inflightRef.current = myToken

    try {
      const r = await searchAiProducts(trimmed, 8)
      if (inflightRef.current !== myToken) return
      const assistantMsg: AiChatMessage = {
        id: newMessageId(),
        role: "assistant",
        content: r ? assistantSummary(trimmed, r.products) : "Couldn't reach the search service. Try again.",
        ts: Date.now(),
        products: r?.products ?? undefined,
        interpretation: r?.interpretation,
        mode: r?.mode,
        count: r?.count,
        failed: !r,
      }
      setThread((t) => ({
        ...t,
        messages: [...t.messages, assistantMsg],
        updated_at: Date.now(),
      }))
    } catch {
      if (inflightRef.current === myToken) {
        setThread((t) => ({
          ...t,
          messages: [
            ...t.messages,
            {
              id: newMessageId(),
              role: "assistant",
              content: "Search hit an error. Try again.",
              ts: Date.now(),
              failed: true,
            },
          ],
          updated_at: Date.now(),
        }))
      }
    } finally {
      if (inflightRef.current === myToken) setLoading(false)
    }
  }, [input, loading])

  const onClear = useCallback(() => {
    clearThread()
    setThread(emptyThread())
  }, [])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search products"
      className="fixed inset-0 z-50 flex flex-col bg-white sm:items-center sm:justify-center sm:bg-black/40 sm:p-6"
    >
      {/* Click backdrop to close */}
      <button
        type="button"
        aria-label="Close search"
        className="absolute inset-0 hidden cursor-default sm:block"
        onClick={() => setOpen(false)}
        tabIndex={-1}
      />
      <div className="relative z-10 flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[80vh] sm:max-w-2xl sm:rounded-2xl sm:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-col">
            <p className="text-sm font-medium text-neutral-900 sm:text-base">
              AI search
            </p>
            <p className="text-xs text-neutral-500">
              Describe what you want, get matching products.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {thread.messages.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Message list */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5"
        >
          {thread.messages.length === 0 && !loading && (
            <EmptyState />
          )}
          <ol className="flex flex-col gap-4">
            {thread.messages.map((m) => (
              <li key={m.id}>
                {m.role === "user" ? (
                  <UserBubble content={m.content} ts={m.ts} />
                ) : (
                  <AssistantBubble msg={m} />
                )}
              </li>
            ))}
            {loading && (
              <li>
                <AssistantSkeleton />
              </li>
            )}
          </ol>
        </div>

        {/* Input row */}
        <div className="border-t border-neutral-200 p-3 sm:p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            className="flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={PLACEHOLDER}
              className="flex-1 rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 sm:text-base"
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={loading || input.trim().length < 2}
              className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:text-base"
            >
              {loading ? "…" : "Send"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
})

AiSearchChat.displayName = "AiSearchChat"

export default AiSearchChat

// ── Sub-components ─────────────────────────────────────────────────────

const assistantSummary = (
  query: string,
  products: AiSearchProduct[] | undefined
): string => {
  const n = products?.length ?? 0
  if (n === 0) return `Nothing matched "${query}". Try simpler keywords.`
  if (n === 1) return `Here's one match for "${query}".`
  return `Here are ${n} matches for "${query}".`
}

const EmptyState = () => (
  <div className="flex h-full flex-col items-center justify-center py-12 text-center">
    <div className="mb-3 text-3xl">🪡</div>
    <p className="text-sm text-neutral-700 sm:text-base">
      Ask in your own words.
    </p>
    <p className="mt-1 max-w-sm text-xs text-neutral-500 sm:text-sm">
      Try things like <em>"soft cotton dress for summer"</em>,{" "}
      <em>"red silk under 3000"</em>, or <em>"naturally dyed handloom"</em>.
    </p>
  </div>
)

const UserBubble = ({ content, ts }: { content: string; ts: number }) => (
  <div className="flex justify-end">
    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-neutral-900 px-3.5 py-2 text-sm text-white sm:text-base">
      {content}
      <div className="mt-0.5 text-right text-[10px] text-neutral-400 sm:text-[11px]">
        {formatRelativeTime(ts)}
      </div>
    </div>
  </div>
)

const AssistantBubble = ({ msg }: { msg: AiChatMessage }) => {
  const products = msg.products ?? []
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%] rounded-2xl rounded-bl-sm border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-sm text-neutral-900 sm:text-base">
        <p>{msg.content}</p>
        {products.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {products.map((p) => (
              <ProductRow key={p.id} product={p} />
            ))}
          </ul>
        )}
        {msg.interpretation && (
          <p className="mt-2 text-[11px] text-neutral-500 sm:text-xs">
            Interpreted as:{" "}
            {[
              msg.interpretation.keywords?.join(", "),
              msg.interpretation.color,
              msg.interpretation.material,
              msg.interpretation.max_price ? `under ${msg.interpretation.max_price}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
    </div>
  )
}

const ProductRow = ({ product }: { product: AiSearchProduct }) => {
  const attribution = product.storefront
  const isPartner = attribution?.kind === "partner" && Boolean(attribution.url)

  const inner = (
    <>
      {product.thumbnail ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={product.thumbnail}
          alt=""
          className="h-12 w-12 shrink-0 rounded-md object-cover sm:h-14 sm:w-14"
        />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded-md bg-neutral-200 sm:h-14 sm:w-14" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium sm:text-base">
            {product.title}
          </p>
          {isPartner && (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 sm:text-[11px]">
              Partner
            </span>
          )}
        </div>
        {isPartner && attribution.partner_name && (
          <p className="text-xs text-neutral-500">
            sold by {attribution.partner_name}
          </p>
        )}
      </div>
    </>
  )

  if (isPartner && attribution.url) {
    return (
      <li>
        <a
          href={attribution.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg bg-white p-2 hover:bg-amber-50/40"
        >
          {inner}
        </a>
      </li>
    )
  }
  return (
    <li>
      <LocalizedClientLink
        href={`/products/${product.handle}`}
        className="flex items-center gap-3 rounded-lg bg-white p-2 hover:bg-neutral-100"
      >
        {inner}
      </LocalizedClientLink>
    </li>
  )
}

const AssistantSkeleton = () => (
  <div className="flex justify-start">
    <div className="rounded-2xl rounded-bl-sm border border-neutral-200 bg-neutral-50 px-3.5 py-3">
      <div className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:240ms]" />
      </div>
    </div>
  </div>
)
