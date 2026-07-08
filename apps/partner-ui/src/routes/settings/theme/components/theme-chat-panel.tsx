/**
 * Theme editor LLM chat panel (#339).
 *
 * Streaming chat that takes natural-language theme edit requests and
 * proposes structured patches via the `update_theme` tool. The user
 * reviews each proposal and clicks Apply — patches are never auto-applied
 * (propose-then-apply UX).
 *
 * Mirrors the storefront concierge chat pattern (useChat + DefaultChatTransport)
 * but targets the partner-authenticated theme chat endpoint.
 */
import { useState, useRef, useEffect, useCallback } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Button, Text, IconButton, Tooltip, toast } from "@medusajs/ui"
import { Sparkles, X, ArrowUpMini, Check } from "@medusajs/icons"
import { sdk, backendUrl } from "../../../../lib/client"

const jwtTokenStorageKey =
  __JWT_TOKEN_STORAGE_KEY__ || "partner_ui_auth_token"

type SafeThemePatch = Record<string, Record<string, unknown>>

type ThemeChatPanelProps = {
  open: boolean
  onClose: () => void
  onApplyPatch: (patch: SafeThemePatch) => void
}

/** Collapsible reasoning section — shows the LLM's chain-of-thought in a muted style. */
function ReasoningBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="text-ui-fg-muted">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-xs flex items-center gap-x-1 hover:text-ui-fg-subtle transition-colors"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span>Reasoning</span>
      </button>
      {expanded && (
        <Text size="xsmall" className="block mt-1 ml-3 italic opacity-70 whitespace-pre-wrap">
          {text}
        </Text>
      )}
    </div>
  )
}

export const ThemeChatPanel = ({
  open,
  onClose,
  onApplyPatch,
}: ThemeChatPanelProps) => {
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  // Track which tool calls have been applied so the button switches to a
  // "Applied" state and can't be double-applied.
  const [appliedCalls, setAppliedCalls] = useState<Set<string>>(new Set())

  const transport = new DefaultChatTransport({
    api: `${backendUrl.replace(/\/$/, "")}/partners/storefront/website/theme/chat`,
    credentials: "include",
    headers: () => {
      const token =
        (sdk as any).client?.token ||
        (typeof window !== "undefined"
          ? localStorage.getItem(jwtTokenStorageKey)
          : null)
      return token ? { Authorization: `Bearer ${token}` } : {}
    },
  })

  const { messages, sendMessage, status, error } = useChat({
    transport,
  })

  // Check if we already received a tool result — if so, suppress the error
  // message since the proposed edit was successfully delivered (the error
  // is typically from the follow-up text generation failing, not the tool call).
  const hasToolResult = messages.some((m) =>
    m.parts.some((p: any) => p.type === "tool-update_theme" && (p.output || p.input))
  )

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleApply = useCallback(
    (toolCallId: string, patch: SafeThemePatch) => {
      onApplyPatch(patch)
      setAppliedCalls((prev) => new Set(prev).add(toolCallId))
      toast.success("Theme edit applied")
    },
    [onApplyPatch]
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || status !== "ready") return
    sendMessage({ text: input.trim() })
    setInput("")
  }

  if (!open) return null

  return (
    <div className="w-[340px] border-l border-ui-border-base bg-ui-bg-base flex flex-col shrink-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ui-border-base">
        <div className="flex items-center gap-x-2">
          <Sparkles className="text-ui-fg-subtle" />
          <Text size="small" weight="plus">AI Theme Assistant</Text>
        </div>
        <Tooltip content="Close">
          <IconButton variant="transparent" size="small" onClick={onClose}>
            <X />
          </IconButton>
        </Tooltip>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-4"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-y-2">
            <Sparkles className="text-ui-fg-subtle" />
            <Text size="small" className="text-ui-fg-subtle">
              Describe a change and I'll propose a theme edit.
            </Text>
            <div className="flex flex-col gap-y-1 mt-2">
              {[
                "Make the header sticky",
                "Swap primary font to serif",
                "Use a warm beige background",
                "Add a fade-up animation to the hero",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs text-ui-fg-subtle hover:text-ui-fg-base bg-ui-bg-subtle hover:bg-ui-bg-hover rounded-md px-3 py-1.5 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id}>
            {m.role === "user" && (
              <div className="flex justify-end">
                <div className="bg-ui-bg-highlight rounded-lg rounded-br-sm px-3 py-2 max-w-[85%]">
                  <Text size="small">{getText(m.parts)}</Text>
                </div>
              </div>
            )}
            {m.role === "assistant" && (
              <div className="space-y-3">
                {m.parts.map((part, i) => {
                  if (part.type === "reasoning") {
                    const text = (part as any).text || ""
                    if (!text) return null
                    return <ReasoningBlock key={i} text={text} />
                  }
                  if (part.type === "text" && part.text) {
                    return (
                      <div
                        key={i}
                        className="bg-ui-bg-subtle rounded-lg rounded-bl-sm px-3 py-2 max-w-[90%]"
                      >
                        <Text size="small">{part.text}</Text>
                      </div>
                    )
                  }
                  if (part.type === "tool-update_theme") {
                    const patch = (part.output as any)?.patch ?? part.input
                    if (!patch || typeof patch !== "object") return null
                    const isApplied = appliedCalls.has(part.toolCallId)
                    return (
                      <ProposedEditCard
                        key={i}
                        patch={patch}
                        applied={isApplied}
                        onApply={() =>
                          handleApply(part.toolCallId, patch)
                        }
                      />
                    )
                  }
                  if (part.type === "tool-list_media") {
                    const result = part.output as any
                    if (!result || !result.files?.length) return null
                    return (
                      <div key={i} className="space-y-1">
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {result.note || "Media library"}
                        </Text>
                        <div className="grid grid-cols-3 gap-1.5">
                          {result.files.slice(0, 9).map((f: any) => (
                            <img
                              key={f.id}
                              src={f.url}
                              alt={f.id}
                              className="h-14 w-full object-cover rounded border border-ui-border-base"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none"
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  }
                  return null
                })}
              </div>
            )}
          </div>
        ))}

        {status === "submitted" && (
          <div className="flex items-center gap-x-1 px-2">
            <span className="h-2 w-2 bg-ui-fg-muted rounded-full animate-pulse" />
            <span className="h-2 w-2 bg-ui-fg-muted rounded-full animate-pulse [animation-delay:0.2s]" />
            <span className="h-2 w-2 bg-ui-fg-muted rounded-full animate-pulse [animation-delay:0.4s]" />
          </div>
        )}

        {error && !hasToolResult && (
          <Text size="small" className="text-ui-tag-red-text">
            Something went wrong. Try again.
          </Text>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-ui-border-base p-3 flex items-end gap-x-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
          rows={1}
          placeholder="Describe a change…"
          className="flex-1 resize-none rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-2 text-sm focus:outline-none focus:border-ui-border-interactive max-h-24"
        />
        <IconButton type="submit" size="large" disabled={!input.trim() || status !== "ready"}>
          <ArrowUpMini />
        </IconButton>
      </form>
    </div>
  )
}

/** Extract text content from message parts (handles both text and tool parts). */
function getText(parts: any[]): string {
  return parts
    ?.filter((p) => p.type === "text")
    .map((p) => p.text)
    .join(" ") ?? ""
}

const IMAGE_KEY_PATTERNS = /image_url|background_image_url|logo_url|favicon_url|avatar_url/i

/** Compact summary of a proposed theme patch for display. */
function describePatch(patch: SafeThemePatch): Array<{ text: string; imageUrl?: string }> {
  const entries: Array<{ text: string; imageUrl?: string }> = []
  if (!patch || typeof patch !== "object") return entries
  for (const [section, fields] of Object.entries(patch)) {
    if (!fields || typeof fields !== "object") continue
    for (const [key, value] of Object.entries(fields)) {
      const isImage = IMAGE_KEY_PATTERNS.test(key) && typeof value === "string" && value
      entries.push({
        text: `${section}.${key} → ${isImage ? "(image)" : String(value)}`,
        imageUrl: isImage ? value : undefined,
      })
    }
  }
  return entries
}

function ProposedEditCard({
  patch,
  applied,
  onApply,
}: {
  patch: SafeThemePatch
  applied: boolean
  onApply: () => void
}) {
  const changes = describePatch(patch)
  return (
    <div className="border border-ui-border-base rounded-lg p-3 bg-ui-bg-base space-y-2">
      <Text size="xsmall" weight="plus" className="text-ui-fg-subtle uppercase tracking-wide">
        Proposed edit
      </Text>
      <div className="space-y-1.5">
        {changes.map((c, i) => (
          <div key={i} className="flex items-start gap-x-1.5">
            <span className="text-ui-tag-green-text text-xs mt-0.5">→</span>
            <div className="flex-1 min-w-0">
              <Text size="xsmall" className="font-mono break-all">{c.text}</Text>
              {c.imageUrl && (
                <img
                  src={c.imageUrl}
                  alt="preview"
                  className="mt-1 h-16 w-full object-cover rounded border border-ui-border-base"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none"
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end pt-1">
        <Button
          size="small"
          variant={applied ? "transparent" : "primary"}
          onClick={onApply}
          disabled={applied}
        >
          {applied ? (
            <>
              <Check /> Applied
            </>
          ) : (
            "Apply"
          )}
        </Button>
      </div>
    </div>
  )
}
