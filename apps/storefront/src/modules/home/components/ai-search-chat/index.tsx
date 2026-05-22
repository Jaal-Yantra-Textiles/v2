"use client"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
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
import { getOrCreateVisitorId } from "@lib/util/visitor-id"
import OnboardingForm from "./onboarding"
import ExitPrompt from "./exit-prompt"

/**
 * Chat-style concierge modal.
 *
 * Streams responses from POST /api/ai-chat (proxy → /store/ai/chat).
 * Uses `useChat` from @ai-sdk/react so tool-call lifecycles, partial
 * tokens, and message parts all wire up correctly. The transport
 * appends `visitor_id` + `prefs` to every request body so the agent
 * has personalisation context on every turn.
 *
 * Onboarding renders the very first time a customer opens the chat
 * (or until they tap "skip"); after that, the modal goes straight to
 * the conversation view. Prefs persist locally — see
 * `lib/util/ai-chat-preferences.ts`.
 *
 * Visitor id reuses `localStorage["jyt_visitor_id"]` so the chat ties
 * back to the same anonymous identity used by cart + analytics. A
 * future iteration will sync threads server-side on sign-in.
 */

export type AiSearchChatHandle = {
  open: (initialQuery?: string) => void
  close: () => void
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

type AiSearchChatProps = { ref?: Ref<AiSearchChatHandle> }

export default function AiSearchChat({ ref }: AiSearchChatProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [prefs, setPrefs] = useState<AiChatPreferences>({})
  const [showOnboarding, setShowOnboarding] = useState(false)
  // Dirty state of the onboarding form. Lives here (not in
  // OnboardingForm) so the close path can decide whether to confirm.
  const [onboardingDirty, setOnboardingDirty] = useState(false)
  // When set, the exit prompt is showing because the user tried to
  // close with unsaved selections. Confirming the prompt calls into
  // this callback.
  const [pendingClose, setPendingClose] = useState<null | (() => void)>(null)
  // Lazily resolved on open — SSR can't touch localStorage.
  const visitorIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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

  useImperativeHandle(
    ref,
    () => ({
      open: (initialQuery) => {
        // Read prefs + visitor id at open time so we always have the
        // freshest values (another tab may have updated localStorage).
        const loaded = loadPreferences()
        setPrefs(loaded)
        visitorIdRef.current = getOrCreateVisitorId()
        setShowOnboarding(!loaded.onboarded)
        setOpen(true)
        if (initialQuery !== undefined) setInput(initialQuery)
        window.setTimeout(() => inputRef.current?.focus(), 0)
      },
      close: () => setOpen(false),
    }),
    []
  )

  // Centralised close request. Backdrop click, the X button, and the
  // Escape key all flow through this so the dirty-prompt is enforced
  // exactly once and the "Leave" / "Cancel" paths agree. Returning
  // early when the exit prompt is already on screen prevents the
  // prompt from blinking when the user hammers Escape.
  const requestClose = useCallback(() => {
    if (pendingClose) return
    if (showOnboarding && onboardingDirty) {
      setPendingClose(() => () => {
        setOpen(false)
        setPendingClose(null)
      })
      return
    }
    setOpen(false)
  }, [pendingClose, showOnboarding, onboardingDirty])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, requestClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

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
  }, [setMessages])

  const onOnboardingDone = useCallback((next: AiChatPreferences) => {
    setPrefs(next)
    setShowOnboarding(false)
    setOnboardingDirty(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const onOnboardingSkip = useCallback(() => {
    // Persist the onboarded flag so we don't show this again — but
    // leave the empty prefs in state as-is. savePreferences() in the
    // skip handler already wrote { onboarded: true }.
    setPrefs((p) => ({ ...p, onboarded: true }))
    setShowOnboarding(false)
    setOnboardingDirty(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const onResetPrefs = useCallback(() => {
    savePreferences({ onboarded: false })
    setPrefs({ onboarded: false })
    setShowOnboarding(true)
  }, [])

  if (!open) return null

  // Two layouts share the same backdrop:
  //   - Onboarding: FocusModal-style. The panel is the full viewport on
  //     every breakpoint so the form has space to breathe and body
  //     scroll is fully blocked (the dialog itself is the scroll
  //     container). No rounded panel, no backdrop padding.
  //   - Chat: standard centred panel that floats inside a dimmed
  //     backdrop on sm+.
  const panelLayout = showOnboarding
    ? // Full-bleed on every breakpoint.
      "flex h-full w-full flex-col bg-white"
    : // Centred panel with a dimmed backdrop on sm+.
      "flex h-full w-full flex-col bg-white sm:h-[80vh] sm:max-h-[680px] sm:w-full sm:max-w-2xl sm:rounded-2xl sm:shadow-2xl"
  const wrapperLayout = showOnboarding
    ? "fixed inset-0 z-50 flex flex-col bg-white"
    : "fixed inset-0 z-50 flex flex-col bg-white sm:items-center sm:justify-center sm:bg-black/40 sm:p-6"

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={showOnboarding ? "Tell us what you like" : "AI concierge"}
      className={wrapperLayout}
    >
      {/* Backdrop click only closes the chat view — onboarding is a
          focus modal, so backdrop is solid and not clickable. */}
      {!showOnboarding && (
        <button
          type="button"
          aria-label="Close"
          className="absolute inset-0 hidden cursor-default sm:block"
          onClick={requestClose}
          tabIndex={-1}
        />
      )}
      <div className={`relative z-10 ${panelLayout}`}>
        <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-col">
            <p className="text-sm font-medium text-neutral-900 sm:text-base">
              Cici concierge
            </p>
            <p className="text-xs text-neutral-500">
              Ask about products, fabrics, custom design, or sizing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!showOnboarding && messages.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
              >
                Clear
              </button>
            )}
            {!showOnboarding && (
              <button
                type="button"
                onClick={onResetPrefs}
                className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
                title="Update your preferences"
              >
                Prefs
              </button>
            )}
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        {showOnboarding ? (
          <OnboardingForm
            initial={prefs}
            onDone={onOnboardingDone}
            onSkip={onOnboardingSkip}
            onDirtyChange={setOnboardingDirty}
          />
        ) : (
          <>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5"
            >
              {messages.length === 0 && !isStreaming && <EmptyState prefs={prefs} />}
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
                {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
                  <li>
                    <AssistantSkeleton />
                  </li>
                )}
                {error && (
                  <li>
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
                      Something went wrong. {error.message ? `(${error.message})` : ""} Try again.
                    </div>
                  </li>
                )}
              </ol>
            </div>

            <div className="border-t border-neutral-200 p-3 sm:p-4">
              <form onSubmit={onSubmit} className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={PLACEHOLDER}
                  disabled={isStreaming}
                  className="flex-1 rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base"
                  maxLength={500}
                  autoComplete="off"
                  spellCheck={false}
                />
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={() => stop()}
                    className="rounded-full bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-300 sm:text-base"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={input.trim().length < 2}
                    className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:text-base"
                  >
                    Send
                  </button>
                )}
              </form>
            </div>
          </>
        )}
      </div>
      {/* Unsaved-changes prompt — appears above the modal when the user
          tries to dismiss the onboarding sheet mid-edit. */}
      <ExitPrompt
        open={!!pendingClose}
        title="Unsaved selections"
        description="You've started telling us what you like. Leave anyway?"
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        onCancel={() => setPendingClose(null)}
        onConfirm={() => pendingClose?.()}
      />
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
    <div className="flex h-full flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 text-3xl">🪡</div>
      <p className="text-sm text-neutral-700 sm:text-base">
        {hasPrefs ? "Where should we start?" : "Ask in your own words."}
      </p>
      <p className="mt-1 max-w-sm text-xs text-neutral-500 sm:text-sm">
        Try <em>"show me a soft handwoven cotton kurta"</em>, ask{" "}
        <em>"how does custom design work?"</em>, or pick a fabric you like.
      </p>
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
    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-neutral-900 px-3.5 py-2 text-sm text-white sm:text-base whitespace-pre-wrap">
      {messageText(msg)}
    </div>
  </div>
)

const AssistantBubble = ({ msg }: { msg: UIMessage }) => {
  const parts = (msg as any).parts as Array<any> | undefined
  if (!parts?.length) {
    return (
      <div className="flex justify-start">
        <div className="rounded-2xl rounded-bl-sm border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-sm text-neutral-900 sm:text-base">
          <AssistantTypingDots />
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%] rounded-2xl rounded-bl-sm border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-sm text-neutral-900 sm:text-base">
        {parts.map((part: any, i: number) => {
          if (part.type === "text") {
            return (
              <p key={i} className="whitespace-pre-wrap">
                {part.text}
              </p>
            )
          }
          // Tool calls in the v5 protocol are typed as `tool-<name>`.
          if (typeof part.type === "string" && part.type.startsWith("tool-")) {
            return <SearchProductsCall key={i} part={part} />
          }
          return null
        })}
      </div>
    </div>
  )
}

const SearchProductsCall = ({ part }: { part: any }) => {
  const state = part?.state as string | undefined
  // Show a small "looking up" pill while the tool is running.
  if (state === "input-streaming" || state === "input-available") {
    const args = part.input ?? {}
    const summary = [args.query, args.color, args.material]
      .filter(Boolean)
      .join(" · ")
    return (
      <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
        Looking for{summary ? ` "${summary}"` : ""}…
      </p>
    )
  }
  if (state === "output-error") {
    return (
      <p className="mt-2 text-xs text-red-600">
        Couldn't reach the catalogue right now.
      </p>
    )
  }
  if (state === "output-available") {
    const output = part.output as SearchToolOutput
    const products = output?.products ?? []
    if (!products.length) {
      return (
        <p className="mt-2 text-xs text-neutral-500">
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
        <div className="h-12 w-12 shrink-0 rounded-md bg-neutral-200 sm:h-14 sm:w-14" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium sm:text-base">{product.title}</p>
          {isPartner && (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 sm:text-[11px]">
              Partner
            </span>
          )}
        </div>
        {isPartner && attribution.kind === "partner" && attribution.partner_name && (
          <p className="text-xs text-neutral-500">sold by {attribution.partner_name}</p>
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

const AssistantTypingDots = () => (
  <span className="flex items-center gap-1">
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:120ms]" />
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:240ms]" />
  </span>
)

const AssistantSkeleton = () => (
  <div className="flex justify-start">
    <div className="rounded-2xl rounded-bl-sm border border-neutral-200 bg-neutral-50 px-3.5 py-3">
      <AssistantTypingDots />
    </div>
  </div>
)
