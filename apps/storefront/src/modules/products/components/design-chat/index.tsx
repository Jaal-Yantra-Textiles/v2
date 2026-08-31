"use client"

import React from "react"
import clsx from "clsx"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { useLenis } from "lenis/react"
import { Button, Text } from "@medusajs/ui"
import {
  ArrowLeft,
  ArrowUpMini,
  ImageSparkle,
  Spinner,
  StopCircleSolid,
} from "@medusajs/icons"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import {
  AttachButton,
  AttachmentThumbnails,
  type AttachmentThumbData,
} from "./components/attachments"
import {
  createReference,
  isAcceptedImage,
  releaseReference,
  uploadDesignReference,
  type DesignReference,
} from "./lib/design-uploads"
import {
  loadPreferences,
  savePreferences,
  toWireFormat,
  type AiChatPreferences,
} from "@lib/util/ai-chat-preferences"
import { getOrCreateVisitorId } from "@lib/util/visitor-id"
import { loadDesignerEmail, saveDesignerEmail } from "@lib/util/designer-email"
import { DesignCheckoutModal } from "@modules/products/components/design-editor/components/design-checkout-modal"
import { ScenePanel, ScenePanelGeneratingSkeleton, normalizeScene } from "./components/scene-panel"
import { MarkdownContent } from "./components/markdown-content"
import {
  DESIGN_TOOL_PARTS,
  PRODUCT_TOOL_PARTS,
  TextLineSkeleton,
  ToolStatusChip,
  type MaterialHit,
  type PartnerHit,
} from "./components/message-parts"
import {
  resolveThreadKey,
  loadDesignThread,
  saveDesignThread,
  type DesignThreadMeta,
} from "./lib/design-thread"
import {
  mirrorDesignThread,
  listDesignConversations,
  type StoredUIMessage,
} from "./lib/design-conversations"
import { pickDesignCanvas } from "./lib/design-pick"
import { retrieveCustomerFresh } from "@lib/data/customer"

/**
 * Chat-based design editor — replaces the Konva editor on the design routes.
 *
 * The maker chats; Cici's designer walks them through brief → moodboard →
 * fabrics → partner → generation → iteration. The board (right column on
 * desktop, bottom tab on mobile) renders the Excalidraw scene from
 * design.moodboard read-only: canvas takes A/B with pick actions,
 * inspirations, board notes. Checkout reuses the dormant editor's modal.
 *
 * Streams from /api/ai-chat via useChat (same proxy as the concierge chat —
 * the proxy forwards the raw body verbatim, so `context` flows through to the
 * backend's design-editor mode). Threads persist to localStorage per base
 * product and mirror to the server-backed conversation store (email-scoped)
 * after each completed turn.
 */

type DesignChatProps = {
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
  isMobileLayout?: boolean
}

const PLACEHOLDER = "Describe what you want to design…"

const toStored = (messages: UIMessage[]): StoredUIMessage[] =>
  messages.map((m) => {
    const anyMsg = m as any
    return {
      id: anyMsg.id,
      role: anyMsg.role,
      content: anyMsg.content,
      parts: anyMsg.parts,
    }
  })

export default function DesignChat({
  product,
  initialDesign,
  countryCode,
  isMobileLayout: initialMobileLayout = false,
}: DesignChatProps) {
  const threadKey = resolveThreadKey(product?.id)
  const [isMobileLayout, setIsMobileLayout] = React.useState(initialMobileLayout)
  const [prefs, setPrefs] = React.useState<AiChatPreferences>({})
  const [input, setInput] = React.useState("")
  const [meta, setMeta] = React.useState<DesignThreadMeta>({ threadKey })
  const [designId, setDesignId] = React.useState<string | null>(
    initialDesign?.id ?? null
  )
  // The design's thumbnail (active pick) — refreshed after picks/generations.
  const [thumbnailUrl, setThumbnailUrl] = React.useState<string | null>(
    initialDesign?.thumbnail_url ?? null
  )
  const [scene, setScene] = React.useState(() =>
    normalizeScene(initialDesign?.moodboard)
  )
  const [picking, setPicking] = React.useState(false)
  const [showCheckout, setShowCheckout] = React.useState(false)
  const [selectedMaterial, setSelectedMaterial] = React.useState<MaterialHit | null>(null)
  const [selectedPartner, setSelectedPartner] = React.useState<PartnerHit | null>(null)
  // Deterministic onboarding — a fresh thread asks garment type + email
  // BEFORE the chat starts, so the guide's first save_brief never fires
  // blind (the model was looping "Brief needs a garment type" instead of
  // asking). Skippable: "Let Cici ask me" hands it to the model.
  const [showOnboarding, setShowOnboarding] = React.useState(false)
  const [onboardingGarment, setOnboardingGarment] = React.useState("")
  const [onboardingEmail, setOnboardingEmail] = React.useState("")
  const [attachments, setAttachments] = React.useState<DesignReference[]>([])
  const [uploading, setUploading] = React.useState(false)

  const visitorIdRef = React.useRef<string | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const scrollAnchorRef = React.useRef<HTMLDivElement>(null)
  const restoredRef = React.useRef(false)
  const persistedRef = React.useRef<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const pendingSendRef = React.useRef<DesignReference[] | null>(null)
  const seenUserMsgIdsRef = React.useRef<Set<string>>(new Set())

  // Mobile detection (chat shell only — the scene panel collapses to a tab).
  React.useEffect(() => {
    const check = () => setIsMobileLayout(window.innerWidth < 1024)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  // Chat transport — same proxy as the concierge chat; the body carries the
  // design context that switches the backend into designer-guide mode.
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai-chat",
        body: () => ({
          visitor_id: visitorIdRef.current ?? "anonymous",
          prefs: toWireFormat(prefs),
          context: {
            ...(product?.id ? { product_id: product.id } : {}),
            ...(designId ? { design_id: designId } : {}),
            ...(meta.email ? { email: meta.email } : {}),
          },
        }),
      }),
    [prefs, product?.id, designId, meta.email]
  )

  const {
    messages,
    sendMessage,
    status,
    error,
    setMessages,
    stop,
  } = useChat({ transport })
  const lenis = useLenis()

  const isStreaming = status === "submitted" || status === "streaming"
  const isGenerating = messages.some(
    (m) =>
      m.role === "assistant" &&
      ((m as any).parts ?? []).some(
        (p: any) =>
          p?.type === "tool-generate_design_image" &&
          (p?.state === "input-streaming" || p?.state === "input-available")
      )
  )

  // ── Restore + mirror on mount ──
  React.useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    visitorIdRef.current = getOrCreateVisitorId()
    setPrefs(loadPreferences())

    const local = loadDesignThread(threadKey)
    // The maker's email is remembered globally — a NEW design never re-asks
    // for it, only for the garment type. Signed-in customers override below.
    const rememberedEmail = loadDesignerEmail()
    if (local?.messages?.length) {
      setMeta({ ...local.meta, email: local.meta.email ?? rememberedEmail ?? undefined })
      setMessages(local.messages)
      if (local.meta.designId) setDesignId(local.meta.designId)
    } else {
      if (rememberedEmail) setMeta((prev) => ({ ...prev, email: rememberedEmail }))
      // Fresh thread — run onboarding first, then the greeting.
      setShowOnboarding(true)
      setMessages([
        {
          id: "greeting",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: product
                ? `Hi! I'm Cici's designer. Let's make something with the ${product.title}. What are we designing, and what should we call it?`
                : "Hi! I'm Cici's designer. What are we designing — a kurta, trousers, a saree? Tell me the garment and I'll walk you through it: brief, fabrics, a partner to make it, then takes on your board.",
            },
          ],
        } as UIMessage,
      ])
    }

    // Fresh customer fetch fixes stale cache auth state (mirror of the
    // dormant editor's client-wrapper). If the maker is signed in, seed the
    // email + pull the server thread.
    retrieveCustomerFresh().then((customer) => {
      const email = (customer as any)?.email as string | undefined
      if (email) {
        setMeta((prev) => ({ ...prev, email }))
        listDesignConversations(email, threadKey).then((conversations) => {
          const latest = conversations[0]
          if (
            latest?.id &&
            latest.id !== local?.meta.conversationId &&
            latest.messages?.length
          ) {
            // Server thread is fresher than local — replay it.
            setMeta((prev) => ({
              ...prev,
              conversationId: latest.id,
              designId: latest.design_id ?? prev.designId,
              title: latest.title,
            }))
            setMessages(latest.messages as any)
            if (latest.design_id) setDesignId(latest.design_id)
          }
        })
      }
    }).catch(() => {})
  }, [threadKey, product?.title, setMessages])

  // ── Persist after each completed turn ──
  React.useEffect(() => {
    if (isStreaming || messages.length === 0) return
    const signature = `${messages.length}:${(messages as any).at(-1)?.id ?? ""}`
    if (persistedRef.current === signature) return
    persistedRef.current = signature

    const title =
      meta.title ??
      toStored(messages)
        .find((m) => m.role === "user")
        ?.content?.slice(0, 60) ??
      "New design"

    const nextMeta: DesignThreadMeta = { ...meta, title }
    saveDesignThread({ meta: nextMeta, messages })
    setMeta(nextMeta)

    if (nextMeta.email) {
      mirrorDesignThread({
        conversationId: nextMeta.conversationId,
        customer_email: nextMeta.email,
        thread_key: threadKey,
        title,
        design_id: designId ?? undefined,
        messages: toStored(messages),
      }).then((conversationId) => {
        if (conversationId) {
          setMeta((prev) => ({ ...prev, conversationId }))
        }
      })
    }
  }, [messages, isStreaming, meta, threadKey, designId])

  // ── Attach reference thumbnails to the just-sent user message ──
  // `sendMessage` doesn't give us the message id, so after the send we scan
  // from the tail for the first unseen user message and stitch the resolved
  // references onto its parts. The thumbnails then survive the local thread
  // (persisted with the message) and re-render on reload.
  React.useEffect(() => {
    if (!pendingSendRef.current) return
    const pending = pendingSendRef.current
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== "user" || seenUserMsgIdsRef.current.has(m.id)) continue
      seenUserMsgIdsRef.current.add(m.id)
      pendingSendRef.current = null
      if (pending.length) {
        const attachParts = pending.map((r) => ({
          type: "attachment",
          id: r.id,
          name: r.file.name,
          previewUrl: r.previewUrl,
          publicUrl: r.publicUrl,
          analysis: r.analysis ?? null,
        }))
        setMessages((prev) =>
          prev.map((pm) =>
            pm.id === m.id
              ? ({ ...pm, parts: [...((pm as any).parts ?? []), ...attachParts] } as any)
              : pm
          )
        )
      }
      break
    }
  }, [messages, setMessages])

  // ── Scroll anchoring: follow the window (Lenis) scroll ──
  // The chat no longer owns a nested `overflow-y-auto` list — the whole page
  // scrolls with the window via Lenis. So "stick to bottom" now means: keep
  // the window parked at the bottom anchor as new messages stream in.
  const [stickToBottom, setStickToBottom] = React.useState(true)
  React.useEffect(() => {
    if (!stickToBottom) return
    // The app is wrapped in <ReactLenis root> (smooth-scroll.tsx), which
    // hijacks native scroll — `scrollIntoView` never moves the window. Drive
    // Lenis directly for an instant jump to the bottom anchor; fall back to
    // native scrollIntoView when no Lenis instance is present (tests / SSR).
    if (lenis) {
      lenis.scrollTo(document.documentElement.scrollHeight, {
        immediate: true,
      })
    } else {
      scrollAnchorRef.current?.scrollIntoView({ block: "end" })
    }
  }, [messages, stickToBottom, lenis])

  React.useEffect(() => {
    const onScroll = () => {
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 120
      setStickToBottom(atBottom)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // ── Onboarding submit ──
  const handleOnboardingStart = (e: React.FormEvent) => {
    e.preventDefault()
    const garment = onboardingGarment.trim()
    const email = onboardingEmail.trim().toLowerCase()
    setShowOnboarding(false)
    if (email) {
      setMeta((prev) => ({ ...prev, email }))
      saveDesignerEmail(email)
    }
    if (!garment) return // skipped garment — greeting already asked
    // Compose the first user turn so the guide has the garment type
    // explicitly — save_brief succeeds on the first try.
    const seed = email
      ? `Design a ${garment}. Save my designs to ${email}.`
      : `Design a ${garment}.`
    setInput("")
    setStickToBottom(true)
    sendMessage({ text: seed })
  }

  // ── Handlers ──
  // "start a new design" is a DOMAIN keyword — typed or tapped, it starts a
  // fresh design chat (clears the local thread + board, new conversation on
  // the next turn). No model turn involved.
  const NEW_DESIGN_KEYWORDS = [
    "start a new design",
    "start new design",
    "new design chat",
    "restart design",
  ]
  const isNewDesignIntent = (text: string): boolean => {
    const t = text.trim().toLowerCase()
    return NEW_DESIGN_KEYWORDS.some((k) => t === k || t.startsWith(k))
  }

  const startNewDesign = React.useCallback(() => {
    stop()
    setAttachments((prev) => {
      prev.forEach(releaseReference)
      return []
    })
    const greeting = {
      id: `greeting-${Date.now()}`,
      role: "assistant" as const,
      parts: [
        {
          type: "text",
          text: product
            ? `New design board ready — still the ${product.title}. What are we making this time?`
            : "New design board ready. What are we designing? A kurta, trousers, a saree — tell me the garment and I'll walk you through it.",
        },
      ],
    } as UIMessage
    setMessages([greeting])
    setMeta((prev) => ({ ...prev, conversationId: undefined, title: undefined }))
    setScene(normalizeScene(initialDesign?.moodboard))
    setThumbnailUrl(initialDesign?.thumbnail_url ?? null)
    persistedRef.current = null
    saveDesignThread({
      meta: { threadKey, conversationId: undefined, title: undefined },
      messages: [greeting],
    })
  }, [stop, product?.title, initialDesign, threadKey, setMessages])

  // ── Attachments ──
  const addFiles = React.useCallback((files: File[]) => {
    const accepted = files.filter(isAcceptedImage)
    if (!accepted.length) return
    setAttachments((prev) => [...prev, ...accepted.map(createReference)])
  }, [])

  const removeAttachment = React.useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target) releaseReference(target)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if ((!text && attachments.length === 0) || isStreaming || uploading) return
    if (isNewDesignIntent(text)) {
      setInput("")
      startNewDesign()
      setShowOnboarding(true)
      return
    }
    // If the text carries an email, seed it into the context gate.
    const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)
    if (emailMatch && !meta.email) {
      setMeta((prev) => ({ ...prev, email: emailMatch[0].toLowerCase() }))
      saveDesignerEmail(emailMatch[0].toLowerCase())
    }
    setInput("")
    setStickToBottom(true)

    // Upload pending references first so the message carries their permanent
    // URLs (guests keep session-only previews — thumbnails still render).
    let resolved: DesignReference[] = attachments
    if (attachments.length) {
      setUploading(true)
      setAttachments((prev) => prev.map((a) => ({ ...a, status: "uploading" })))
      resolved = await Promise.all(attachments.map(uploadDesignReference))
      setUploading(false)
    }

    const referenceLines = resolved
      .filter((r) => r.publicUrl)
      .map((r) => {
        const a = r.analysis
        const note =
          a && (a.title || a.description)
            ? ` (I see: ${[a.title, a.description].filter(Boolean).join(". ")})`
            : ""
        return `${r.publicUrl}${note}`
      })

    const referenceBlock = referenceLines.length
      ? `\n\nReference image${referenceLines.length > 1 ? "s" : ""} — my on-the-fly read of each:\n${referenceLines.join("\n")}`
      : ""
    const composed = `${text}${referenceBlock}`.trim() || "I've attached some inspirations."

    pendingSendRef.current = resolved
    setAttachments([])
    sendMessage({ text: composed })
  }

  /**
   * A clicked choice is an ordinary message.
   *
   * 🔑 Deliberately NOT a side channel. The transcript is what the model reads
   * on the next turn and what the conversation store persists, so a pick that
   * bypassed it would vanish on reload and leave the assistant reasoning about
   * a fabric nobody ever mentioned. The button just types the sentence for you.
   *
   * Guarded on `isStreaming`/`uploading` for the same reason the composer is:
   * two turns in flight interleave their tool calls.
   */
  const handleChoice = React.useCallback(
    (text: string) => {
      if (isStreaming || uploading) return
      setStickToBottom(true)
      sendMessage({ text })
    },
    [isStreaming, uploading, sendMessage]
  )

  const handlePickCanvas = async (canvasId: string) => {
    if (!designId || picking) return
    setPicking(true)
    const result = await pickDesignCanvas(designId, canvasId).catch(() => null)
    if (result?.thumbnail_url) {
      setThumbnailUrl(result.thumbnail_url)
      setScene((prev) =>
        prev
          ? {
              ...prev,
              elements: prev.elements.map((el) =>
                el.customData?.canvas
                  ? {
                      ...el,
                      customData: {
                        ...el.customData,
                        canvas: {
                          ...el.customData.canvas,
                          active: el.customData.canvas.id === canvasId,
                        },
                      },
                    }
                  : el
              ),
            }
          : prev
      )
    }
    setPicking(false)
  }

  const refreshScene = async (id?: string) => {
    // After a generation / moodboard pin / design create, the scene lives on
    // the design — a light reload via get_design_state keeps the board current
    // without a full page nav.
    const target = id ?? designId
    if (!target) return
    try {
      const { getDesignScene } = await import("./lib/design-scene")
      // The board read is email-scoped — a guest maker has no customer session,
      // which is exactly why the old customer-authenticated read 401'd.
      const next = await getDesignScene(target, meta.email)
      if (next?.scene) setScene(next.scene)
      if (next?.thumbnail_url) setThumbnailUrl(next.thumbnail_url)
      if (next?.design_id) setDesignId(next.design_id)
    } catch {
      /* board refresh is best-effort */
    }
  }

  React.useEffect(() => {
    // Refresh the board whenever a board-mutating tool completes — generation,
    // moodboard pin, or design creation — so the "Your board" panel always
    // reflects what the model just did. create_design also hands us the
    // design id, which we adopt before refreshing.
    if (isGenerating) return
    let createdId: string | null = null
    let shouldRefresh = false
    for (const m of messages) {
      if (m.role !== "assistant") continue
      for (const p of ((m as any).parts ?? []) as any[]) {
        if (
          p?.type === "tool-create_design" &&
          p?.state === "output-available" &&
          p?.output?.design_id
        ) {
          createdId = p.output.design_id
        }
        if (
          (p?.type === "tool-generate_design_image" ||
            p?.type === "tool-save_moodboard" ||
            p?.type === "tool-create_design") &&
          p?.state === "output-available"
        ) {
          shouldRefresh = true
        }
      }
    }
    if (createdId && createdId !== designId) setDesignId(createdId)
    if (shouldRefresh) refreshScene(createdId ?? undefined)
  }, [messages, isGenerating, designId])

  // ── Message rendering ──
  const renderMessage = (msg: UIMessage) => {
    const parts = ((msg as any).parts ?? []) as any[]
    if (msg.role === "user") {
      const rawText = parts
        .filter((p) => p?.type === "text")
        .map((p) => p.text)
        .join("")
      // Strip the reference-image URL block — thumbnails replace it.
      const text = rawText.split(/\n\nReference images?\b/)[0].trim()
      const attachParts = parts.filter((p) => p?.type === "attachment")
      const thumbs: AttachmentThumbData[] = attachParts.map((p: any) => ({
        id: p.id,
        name: p.name ?? "Reference",
        previewUrl: p.publicUrl ?? p.previewUrl,
        status: p.publicUrl ? "ready" : "preview",
        analysis: p.analysis ?? null,
      }))
      return (
        <div key={msg.id} className="flex justify-end">
          <div className="flex max-w-[80%] flex-col items-end gap-2">
            {thumbs.length > 0 && (
              <AttachmentThumbnails refs={thumbs} compact />
            )}
            {text && (
              <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ui-bg-interactive px-3.5 py-2 text-sm text-white">
                {text}
              </div>
            )}
          </div>
        </div>
      )
    }

    const textParts = parts.filter((p) => p?.type === "text")
    const hasText = textParts.some((p) => p?.text)
    const assistantStreaming =
      isStreaming && msg.id === (messages as any).at(-1)?.id

    return (
      <div key={msg.id} className="flex justify-start">
        <div className="w-full max-w-[92%] rounded-2xl rounded-bl-sm border border-ui-border-base bg-ui-bg-subtle px-3.5 py-3 text-sm text-ui-fg-base">
          {parts.map((part: any, i: number) => {
            if (part?.type === "text") {
              return part.text ? (
                <MarkdownContent key={i} text={part.text} />
              ) : assistantStreaming ? (
                <TextLineSkeleton key={i} />
              ) : null
            }
            if (typeof part?.type === "string" && DESIGN_TOOL_PARTS[part.type]) {
              const Tool = DESIGN_TOOL_PARTS[part.type]
              return (
                <div key={i}>
                  <Tool part={part} onChoose={handleChoice} />
                </div>
              )
            }
            if (
              typeof part?.type === "string" &&
              PRODUCT_TOOL_PARTS.has(part.type)
            ) {
              return <ToolStatusChip key={i} label="Found pieces in the catalogue" tone="done" />
            }
            return null
          })}
          {assistantStreaming && !hasText && !isGenerating && <TextLineSkeleton />}
        </div>
      </div>
    )
  }

  // ── Layout ──
  const boardPanel = (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Text
          weight="plus"
          size="xsmall"
          className="uppercase tracking-widest text-ui-fg-muted"
        >
          Your board
        </Text>
        {designId && (
          <button
            type="button"
            onClick={() => refreshScene()}
            className="text-xs text-ui-fg-muted underline-offset-2 hover:text-ui-fg-base hover:underline"
          >
            Refresh
          </button>
        )}
      </div>

      {isGenerating ? (
        <ScenePanelGeneratingSkeleton />
      ) : (
        <ScenePanel
          scene={scene}
          thumbnailUrl={thumbnailUrl}
          onPickCanvas={designId ? handlePickCanvas : undefined}
          picking={picking}
        />
      )}

      {/* Selected fabric + partner chips */}
      {(selectedMaterial || selectedPartner) && (
        <div className="flex flex-wrap gap-2">
          {selectedMaterial && (
            <span className="inline-flex items-center gap-1 rounded-full bg-ui-tag-green-bg px-2.5 py-1 text-[11px] font-medium text-ui-tag-green-text">
              🧵 {selectedMaterial.name ?? "Fabric"}
              <button
                onClick={() => setSelectedMaterial(null)}
                className="ml-0.5 text-ui-tag-green-text/70 hover:text-ui-tag-green-text"
              >
                ×
              </button>
            </span>
          )}
          {selectedPartner && (
            <span className="inline-flex items-center gap-1 rounded-full bg-ui-tag-purple-bg px-2.5 py-1 text-[11px] font-medium text-ui-tag-purple-text">
              🏭 {selectedPartner.company_name ?? selectedPartner.name}
              <button
                onClick={() => setSelectedPartner(null)}
                className="ml-0.5 text-ui-tag-purple-text/70 hover:text-ui-tag-purple-text"
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}

      <Button
        onClick={() => setShowCheckout(true)}
        disabled={!designId}
        className="w-full rounded-full"
      >
        {designId ? "Checkout design" : "Checkout unlocks after your first take"}
      </Button>
    </div>
  )

  return (
    <div
      className="flex min-h-[100dvh] flex-col bg-ui-bg-subtle"
      data-testid="design-chat-wrapper"
    >
      {/* Studio top bar — the design routes drop the storefront chrome, so
          this bar is the whole shell: back link, wordmark, thread title. */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-ui-border-base bg-ui-bg-base/95 px-3 backdrop-blur sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <LocalizedClientLink
            href={product ? `/products/${product.handle}` : "/store"}
            aria-label="Back to shop"
            title="Back to shop"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ui-border-base text-ui-fg-subtle transition-colors hover:border-ui-border-strong hover:text-ui-fg-base"
          >
            <ArrowLeft className="h-4 w-4" />
          </LocalizedClientLink>
          <div className="flex min-w-0 items-center gap-2">
            <ImageSparkle className="h-4 w-4 shrink-0 text-ui-fg-interactive" />
            <span className="truncate text-sm font-medium text-ui-fg-base">
              Cici Label — Design Studio
            </span>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden min-w-0 truncate text-xs text-ui-fg-muted sm:block">
            {product?.title
              ? `Designing · ${product.title}`
              : meta.title ?? "New design"}
          </span>
          <button
            type="button"
            onClick={() => {
              startNewDesign()
              setShowOnboarding(true)
            }}
            className="shrink-0 rounded-full border border-ui-border-base px-3 py-1.5 text-xs font-medium text-ui-fg-subtle transition-colors hover:border-ui-border-strong hover:text-ui-fg-base"
          >
            New design
          </button>
        </div>
      </header>

      {/* Body — full-width chat + board, both following the window scroll */}
      <div className={clsx("flex w-full flex-1", isMobileLayout && "flex-col")}>
        {/* Chat column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Messages — grows to fill the column so the composer sits at the
              bottom; with a long thread the window (Lenis) scrolls instead. */}
          <div className="flex flex-1 flex-col gap-3 px-4 py-4 sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              {messages.map(renderMessage)}
              {error && (
                <div className="rounded-xl border border-ui-tag-red-border bg-ui-tag-red-bg px-3 py-2 text-xs text-ui-tag-red-text">
                  Something went wrong — try again.
                </div>
              )}
            </div>
          </div>
          {/* Bottom anchor — the window scrolls to here as messages stream. */}
          <div ref={scrollAnchorRef} />

          {/* Onboarding — intro, how-it-works, garment type + email */}
          {showOnboarding && !isStreaming && (
            <div className="mx-auto mb-2 w-full max-w-3xl space-y-3">
              {/* How it works — one glance at the journey ahead */}
              <div className="rounded-2xl border border-ui-border-base bg-ui-bg-subtle p-3.5 px-4 sm:px-6">
                <Text weight="plus" size="small">
                  How it works
                </Text>
                <ol className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    "Tell me the garment — I lock the brief",
                    "We pick your fabrics",
                    "We match an artisan partner",
                    "I generate two takes, you pick one",
                  ].map((step, i) => (
                    <li
                      key={step}
                      className="flex items-start gap-2 text-xs text-ui-fg-subtle"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ui-fg-interactive text-[10px] font-semibold text-ui-fg-on-color">
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <form
                onSubmit={handleOnboardingStart}
                className="rounded-2xl border border-ui-border-base bg-ui-bg-subtle p-3.5 px-4 shadow-sm sm:px-6"
                data-testid="design-chat-onboarding"
              >
                <Text weight="plus" size="small">
                  Let&apos;s start your board
                </Text>
                <Text size="xsmall" className="mb-3 text-ui-fg-subtle">
                  {meta.email
                    ? "What garment are we designing? Your designs save to the email on file."
                    : "Two quick things — the garment and an email to save your designs under."}
                </Text>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={onboardingGarment}
                  onChange={(e) => setOnboardingGarment(e.target.value)}
                  placeholder="What are we designing? (kurta, trousers…)"
                  maxLength={60}
                  className="min-w-0 flex-1 rounded-full border border-ui-border-base bg-ui-bg-field px-3.5 py-2 text-sm outline-none focus:border-ui-border-strong"
                  data-testid="design-chat-onboarding-garment"
                />
                {!meta.email && (
                  <input
                    type="email"
                    value={onboardingEmail}
                    onChange={(e) => setOnboardingEmail(e.target.value)}
                    placeholder="Email (saves your designs)"
                    maxLength={200}
                    className="min-w-0 flex-1 rounded-full border border-ui-border-base bg-ui-bg-field px-3.5 py-2 text-sm outline-none focus:border-ui-border-strong"
                    data-testid="design-chat-onboarding-email"
                  />
                )}
              </div>
              {/*
                The garment as choices, not a blank field.
                `product_type` is load-bearing — the production spec and the
                cost estimate both derive from it (#938) — and a free-typed
                "something flowy for summer" normalises to nothing. These are
                the types the catalogue actually produces; the field stays open
                for anything else.
              */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["Kurta", "Saree", "Trousers", "Shirt", "Scarf", "Shawl", "Robe"].map(
                  (g) => {
                    const selected =
                      onboardingGarment.trim().toLowerCase() === g.toLowerCase()
                    return (
                      <button
                        key={g}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setOnboardingGarment(g.toLowerCase())}
                        className={
                          selected
                            ? "rounded-full border border-ui-border-interactive bg-ui-bg-interactive px-3 py-1 text-[11px] font-medium text-white"
                            : "rounded-full border border-ui-border-base bg-ui-bg-base px-3 py-1 text-[11px] text-ui-fg-subtle transition hover:border-ui-border-interactive hover:text-ui-fg-base"
                        }
                        data-testid={`design-chat-garment-${g.toLowerCase()}`}
                      >
                        {g}
                      </button>
                    )
                  }
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowOnboarding(false)}
                  className="text-[11px] text-ui-fg-muted underline hover:text-ui-fg-base"
                >
                  Let Cici ask me instead
                </button>
                <Button
                  type="submit"
                  className="rounded-full px-5"
                  disabled={onboardingGarment.trim().length < 2}
                  data-testid="design-chat-onboarding-start"
                >
                  Start designing
                </Button>
              </div>
            </form>
            </div>
          )}

          {/* Composer — sticky to the viewport bottom; the page scrolls behind it */}
          <form
            onSubmit={handleSubmit}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              addFiles(Array.from(e.dataTransfer.files ?? []))
            }}
            className="sticky bottom-0 z-10 mx-auto w-full max-w-3xl px-4 pb-4"
          >
            {/* Pending reference thumbnails */}
            {attachments.length > 0 && (
              <div className="mb-2">
                <AttachmentThumbnails
                  refs={attachments.map((a) => ({
                    id: a.id,
                    name: a.file.name,
                    previewUrl: a.previewUrl,
                    status: a.status,
                    error: a.error,
                    analysis: a.analysis,
                  }))}
                  onRemove={removeAttachment}
                />
              </div>
            )}

            {/* Floating centered input pill */}
            <div className="flex items-end gap-1.5 rounded-2xl border border-ui-border-base bg-ui-bg-field p-1.5 pl-3 shadow-elevation-card-rest transition-colors focus-within:border-ui-border-strong">
              <AttachButton
                onFiles={addFiles}
                inputRef={fileInputRef}
                disabled={isStreaming}
              />
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
const emailMatch = e.target.value.match(/[\w.+-]+@[\w-]+\.[\w.]+/)
                    if (emailMatch && !meta.email) {
                      setMeta((prev) => ({ ...prev, email: emailMatch[0].toLowerCase() }))
                      saveDesignerEmail(emailMatch[0].toLowerCase())
                    }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmit(e as any)
                  }
                }}
                rows={1}
                maxLength={1000}
                placeholder={PLACEHOLDER}
                className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
                data-testid="design-chat-input"
              />
              <span className="hidden shrink-0 self-center pr-1 text-[10px] text-ui-fg-muted sm:block">
                {input.length}/1000
              </span>
              {isStreaming ? (
                <Button
                  type="button"
                  onClick={() => stop()}
                  className="h-9 w-9 shrink-0 rounded-full p-0"
                  aria-label="Stop generating"
                >
                  <StopCircleSolid className="h-5 w-5" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={
                    uploading ||
                    (input.trim().length < 2 && attachments.length === 0)
                  }
                  className="h-9 w-9 shrink-0 rounded-full p-0"
                  aria-label="Send message"
                  data-testid="design-chat-send"
                >
                  {uploading ? (
                    <Spinner className="h-5 w-5 animate-spin" />
                  ) : (
                    <ArrowUpMini className="h-5 w-5" />
                  )}
                </Button>
              )}
            </div>

            {uploading && (
              <p className="mt-2 text-[11px] text-ui-fg-muted">
                Uploading references…
              </p>
            )}
          </form>
        </div>

        {/* Board column (desktop) — sticky sidebar so it stays in view while the
            chat scrolls with the window. */}
        {!isMobileLayout && (
          <div
            data-lenis-prevent
            className="sticky top-14 h-[calc(100dvh-3.5rem)] w-80 shrink-0 overflow-y-auto border-l border-ui-border-base px-4 py-6"
          >
            {boardPanel}
          </div>
        )}

        {/* Board sheet (mobile — collapsible bottom section) */}
        {isMobileLayout && (
          <div
            data-lenis-prevent
            className="max-h-[45vh] overflow-y-auto border-t border-ui-border-base bg-ui-bg-subtle px-3 py-3"
          >
            {boardPanel}
          </div>
        )}
      </div>

      {/* Checkout — reuses the dormant editor's modal */}
      <DesignCheckoutModal
        isOpen={showCheckout}
        onClose={() => setShowCheckout(false)}
        designId={designId}
        designName={meta.title ?? "Your design"}
        countryCode={countryCode}
        hasMaterial={Boolean(selectedMaterial)}
        hasPartner={Boolean(selectedPartner)}
      />
    </div>
  )
}
