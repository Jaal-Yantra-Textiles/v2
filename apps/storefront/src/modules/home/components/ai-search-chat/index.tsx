"use client"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { Button, Heading, IconButton, Input, Text } from "@medusajs/ui"
import { ArrowUpMini, StopCircleSolid } from "@medusajs/icons"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  loadPreferences,
  savePreferences,
  toWireFormat,
  type AiChatPreferences,
} from "@lib/util/ai-chat-preferences"
import {
  clearConciergeThread,
  loadConciergeMessages,
  saveConciergeMessages,
} from "@lib/util/concierge-thread"
import { getOrCreateVisitorId } from "@lib/util/visitor-id"
import OnboardingForm, { type OnboardingHandle } from "./onboarding"

/**
 * Full-page Cici concierge chat, rendered at `/[countryCode]/chat`.
 *
 * It used to be a Medusa UI `FocusModal` mounted inside the home hero,
 * but the modal's own scroll fought the pinned hero `ScrollStage` +
 * Lenis + the scroll-driven nav header. Moving it to a dedicated route
 * removes that conflict entirely: the message list owns a native
 * `overflow-y-auto` scroll area while the page itself barely scrolls.
 *
 * The conversation is persisted to localStorage (`concierge-thread.ts`)
 * so a returning visitor resumes the same thread — including streamed
 * product-card tool outputs — and the floating launcher can show an
 * "active thread" dot. An optional `initialQuery` (seeded from the hero
 * search bar via `?q=`) is auto-sent once on mount.
 *
 * Streams from /api/ai-chat via `useChat` from @ai-sdk/react with a
 * DefaultChatTransport so tool-call lifecycles, partial tokens, and
 * message parts all wire up correctly. visitor_id + prefs go in the
 * body on every turn for personalisation.
 */

type AiSearchChatProps = {
  /** Pre-typed query (from the hero search bar) auto-sent once on mount. */
  initialQuery?: string
}

type ProductHit = {
  id: string
  handle: string
  title: string
  subtitle?: string | null
  thumbnail?: string | null
  storefront?:
    | { kind: "main" }
    | {
        kind: "partner"
        url?: string
        partner_name: string
        partner_handle: string
        sales_channel_name?: string
      }
}

type SearchToolOutput = {
  products?: ProductHit[]
  mode?: "vector" | "lexical"
  count?: number
  error?: string
}

const PLACEHOLDER = "Ask me anything — products, fabrics, sizing…"

export default function AiSearchChat({ initialQuery }: AiSearchChatProps) {
  const [input, setInput] = useState("")
  const [prefs, setPrefs] = useState<AiChatPreferences>({})
  const [showOnboarding, setShowOnboarding] = useState(false)

  const visitorIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const onboardingRef = useRef<OnboardingHandle>(null)
  // Guards so the one-time mount effects (restore, auto-send) never
  // re-run and clobber state on re-render / React strict-mode double-invoke.
  const restoredRef = useRef(false)
  const sentInitialRef = useRef(false)

  // useChat transport — re-built when prefs change so the body
  // closure picks up the latest personalisation snapshot.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai-chat",
        body: () => ({
          visitor_id: visitorIdRef.current ?? "anonymous",
          prefs: toWireFormat(prefs),
        }),
      }),
    [prefs]
  )

  const { messages, sendMessage, status, error, setMessages, stop } = useChat({
    transport,
  })

  const isStreaming = status === "submitted" || status === "streaming"

  // Mount: load prefs + visitor id, restore any saved thread, and
  // decide whether to show onboarding. Onboarding is skipped when the
  // visitor arrived with an intent query (?q=) — they came to chat.
  useEffect(() => {
    if (restoredRef.current) return
    const loaded = loadPreferences()
    setPrefs(loaded)
    visitorIdRef.current = getOrCreateVisitorId()
    const hasIntent = Boolean(initialQuery && initialQuery.trim().length >= 2)
    setShowOnboarding(!loaded.onboarded && !hasIntent)
    const saved = loadConciergeMessages()
    if (saved.length) setMessages(saved)
    restoredRef.current = true
  }, [initialQuery, setMessages])

  // Auto-send the seeded query once, on the next tick so it lands after
  // the restore above (the AI SDK appends to its internal message list).
  useEffect(() => {
    const q = initialQuery?.trim()
    if (!q || q.length < 2 || sentInitialRef.current) return
    sentInitialRef.current = true
    const t = window.setTimeout(() => sendMessage({ text: q }), 0)
    return () => window.clearTimeout(t)
  }, [initialQuery, sendMessage])

  // Persist after each settled turn. Never auto-save an empty list —
  // that would let the mount race wipe a restored thread; explicit
  // clears go through clearConciergeThread() in onClear.
  useEffect(() => {
    if (!restoredRef.current || isStreaming) return
    if (messages.length) saveConciergeMessages(messages)
  }, [messages, isStreaming])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [messages, isStreaming])

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = input.trim()
      if (trimmed.length < 2 || isStreaming) return
      sendMessage({ text: trimmed })
      setInput("")
    },
    [input, isStreaming, sendMessage]
  )

  const onClear = useCallback(() => {
    setMessages([])
    clearConciergeThread()
  }, [setMessages])

  const onOnboardingDone = useCallback((next: AiChatPreferences) => {
    setPrefs(next)
    setShowOnboarding(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const onOnboardingSkip = useCallback(() => {
    setPrefs((p) => ({ ...p, onboarded: true }))
    setShowOnboarding(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const onResetPrefs = useCallback(() => {
    savePreferences({ onboarded: false })
    setPrefs({ onboarded: false })
    setShowOnboarding(true)
  }, [])

  return (
    // Fill the viewport minus the sticky nav (h-16 = 64px) so the
    // message list owns a native scroll area and the page itself doesn't
    // scroll — sidestepping the Lenis / scroll-driven-nav conflict that
    // the old in-hero modal hit.
    <div className="flex h-[calc(100dvh-64px)] w-full flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between gap-2 border-b border-ui-border-base py-4">
        <div className="flex flex-col">
          <Heading level="h1" className="text-ui-fg-base">
            Cici concierge
          </Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Ask about products, fabrics, custom design, or sizing.
          </Text>
        </div>
        <div className="flex items-center gap-2">
          {!showOnboarding && messages.length > 0 && (
            <Button variant="transparent" size="small" onClick={onClear}>
              Clear
            </Button>
          )}
          {!showOnboarding && (
            <Button
              variant="transparent"
              size="small"
              onClick={onResetPrefs}
              title="Update your preferences"
            >
              Prefs
            </Button>
          )}
        </div>
      </header>

      {/*
        Two things are required for this list to actually scroll:
          1. `min-h-0` — a flex child defaults to `min-height: auto`, so
             without this the list grows to fit its content instead of
             constraining to `flex-1` and `overflow-y-auto` never engages.
          2. `data-lenis-prevent` — the app is wrapped in `<ReactLenis root>`
             (smooth-scroll.tsx), which hijacks wheel/touch on the whole
             document. Lenis only lets a nested element scroll natively when
             it (or an ancestor) carries this attribute. Without it the
             message list "can't scroll" — wheel/touch drive the page, not
             the list. `overscroll-contain` stops the bounce from chaining
             back out to the page at the ends.
      */}
      <div
        ref={scrollRef}
        data-lenis-prevent
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {showOnboarding ? (
          <OnboardingForm
            ref={onboardingRef}
            initial={prefs}
            onDone={onOnboardingDone}
            onSkip={onOnboardingSkip}
          />
        ) : (
          <div className="py-6">
            {messages.length === 0 && !isStreaming && (
              <EmptyState prefs={prefs} />
            )}
            <ol className="flex flex-col gap-4">
              {messages.map((m) => (
                <li key={m.id}>
                  {m.role === "user" ? (
                    <UserBubble msg={m} />
                  ) : (
                    <AssistantBubble msg={m} />
                  )}
                </li>
              ))}
              {isStreaming &&
                messages[messages.length - 1]?.role !== "assistant" && (
                  <li>
                    <AssistantSkeleton />
                  </li>
                )}
              {error && (
                <li>
                  <div className="rounded-2xl border border-ui-border-error bg-ui-bg-base-error/10 px-3.5 py-3 text-sm text-ui-fg-error">
                    Something went wrong.{" "}
                    {error.message ? `(${error.message})` : ""} Try again.
                  </div>
                </li>
              )}
            </ol>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-ui-border-base py-3">
        {showOnboarding ? (
          <div className="flex w-full items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => onboardingRef.current?.skip()}
            >
              Skip
            </Button>
            <Button
              variant="primary"
              onClick={() => onboardingRef.current?.submit()}
            >
              Looks good
            </Button>
          </div>
        ) : (
          // Input + send-icon laid out as a single rounded "search-bar"
          // affordance — input spans full width, icon button sits
          // absolutely inside it on the right.
          <form onSubmit={onSubmit} className="relative w-full">
            <Input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={PLACEHOLDER}
              disabled={isStreaming}
              className="w-full pr-12"
              maxLength={500}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
              {isStreaming ? (
                <IconButton
                  type="button"
                  variant="transparent"
                  size="small"
                  aria-label="Stop generating"
                  onClick={() => stop()}
                >
                  <StopCircleSolid />
                </IconButton>
              ) : (
                <IconButton
                  type="submit"
                  variant="primary"
                  size="small"
                  aria-label="Send message"
                  disabled={input.trim().length < 2}
                >
                  <ArrowUpMini />
                </IconButton>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────

const EmptyState = ({ prefs }: { prefs: AiChatPreferences }) => {
  const hasPrefs =
    (prefs.colors?.length ?? 0) +
      (prefs.materials?.length ?? 0) +
      (prefs.styles?.length ?? 0) >
    0
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 text-3xl">🪡</div>
      <Text className="text-ui-fg-base">
        {hasPrefs ? "Where should we start?" : "Ask in your own words."}
      </Text>
      <Text size="small" className="mt-1 max-w-sm text-ui-fg-subtle">
        Try <em>&quot;show me a soft handwoven cotton kurta&quot;</em>, ask{" "}
        <em>&quot;how does custom design work?&quot;</em>, or pick a fabric you
        like.
      </Text>
    </div>
  )
}

const messageText = (msg: UIMessage): string => {
  const parts = (msg as any).parts as Array<any> | undefined
  if (!parts) return ""
  return parts
    .filter((p) => p?.type === "text")
    .map((p) => p.text ?? "")
    .join("")
}

const UserBubble = ({ msg }: { msg: UIMessage }) => (
  <div className="flex justify-end">
    <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ui-bg-interactive px-3.5 py-2 text-sm text-ui-fg-on-color sm:text-base">
      {messageText(msg)}
    </div>
  </div>
)

const AssistantBubble = ({ msg }: { msg: UIMessage }) => {
  const parts = (msg as any).parts as Array<any> | undefined
  if (!parts?.length) {
    return (
      <div className="flex justify-start">
        <div className="rounded-2xl rounded-bl-sm border border-ui-border-base bg-ui-bg-subtle px-3.5 py-3 text-sm text-ui-fg-base sm:text-base">
          <AssistantTypingDots />
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%] rounded-2xl rounded-bl-sm border border-ui-border-base bg-ui-bg-subtle px-3.5 py-3 text-sm text-ui-fg-base sm:text-base">
        {parts.map((part: any, i: number) => {
          if (part.type === "text") {
            return (
              <p key={i} className="whitespace-pre-wrap">
                {part.text}
              </p>
            )
          }
          // Only tools that return products render cards. Other tool parts
          // (e.g. get_categories) carry their answer in the model's prose.
          if (
            typeof part.type === "string" &&
            PRODUCT_TOOL_PARTS.has(part.type)
          ) {
            return <SearchProductsCall key={i} part={part} />
          }
          return null
        })}
      </div>
    </div>
  )
}

// Tool parts that return `{ products: [...] }` and therefore render cards.
// Other tools (e.g. get_categories) answer through the model's prose.
const PRODUCT_TOOL_PARTS = new Set([
  "tool-search_products",
  "tool-get_category_products",
  "tool-get_product_details",
])

const SearchProductsCall = ({ part }: { part: any }) => {
  const state = part?.state as string | undefined
  if (state === "input-streaming" || state === "input-available") {
    const args = part.input ?? {}
    const summary = [args.query, args.color, args.material]
      .filter(Boolean)
      .join(" · ")
    return (
      <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-ui-bg-base-pressed px-2.5 py-1 text-xs text-ui-fg-subtle">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ui-fg-muted" />
        Looking for{summary ? ` "${summary}"` : ""}…
      </p>
    )
  }
  if (state === "output-error") {
    return (
      <p className="mt-2 text-xs text-ui-fg-error">
        Couldn&apos;t reach the catalogue right now.
      </p>
    )
  }
  if (state === "output-available") {
    const output = part.output as SearchToolOutput
    const products = output?.products ?? []
    if (!products.length) {
      return (
        <p className="mt-2 text-xs text-ui-fg-subtle">
          No matches in the catalogue for that.
        </p>
      )
    }
    return (
      <ul className="mt-3 flex flex-col gap-2">
        {products.map((p) => (
          <ProductRow key={p.id} product={p} />
        ))}
      </ul>
    )
  }
  return null
}

const ProductRow = ({ product }: { product: ProductHit }) => {
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
        <div className="h-12 w-12 shrink-0 rounded-md bg-ui-bg-base-pressed sm:h-14 sm:w-14" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium sm:text-base">
            {product.title}
          </p>
          {isPartner && (
            <span className="shrink-0 rounded-full border border-ui-tag-orange-border bg-ui-tag-orange-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ui-tag-orange-text sm:text-[11px]">
              Partner
            </span>
          )}
        </div>
        {isPartner &&
          attribution.kind === "partner" &&
          attribution.partner_name && (
            <p className="text-xs text-ui-fg-subtle">
              sold by {attribution.partner_name}
            </p>
          )}
      </div>
    </>
  )
  if (isPartner && attribution.kind === "partner" && attribution.url) {
    return (
      <li>
        <a
          href={attribution.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg bg-ui-bg-base p-2 hover:bg-ui-bg-base-hover"
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
        className="flex items-center gap-3 rounded-lg bg-ui-bg-base p-2 hover:bg-ui-bg-base-hover"
      >
        {inner}
      </LocalizedClientLink>
    </li>
  )
}

const AssistantTypingDots = () => (
  <span className="flex items-center gap-1">
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ui-fg-muted" />
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ui-fg-muted [animation-delay:120ms]" />
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ui-fg-muted [animation-delay:240ms]" />
  </span>
)

const AssistantSkeleton = () => (
  <div className="flex justify-start">
    <div className="rounded-2xl rounded-bl-sm border border-ui-border-base bg-ui-bg-subtle px-3.5 py-3">
      <AssistantTypingDots />
    </div>
  </div>
)
