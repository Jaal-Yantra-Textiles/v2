/**
 * Partner assistant chat thread (#338 item 2).
 *
 * Streaming chat wired to the partner-authenticated assistant endpoint, which
 * drives the Partner API through the MCP tool registry. Extends the theme-chat
 * pattern with:
 *   - server-persisted history: the message array is written back to a
 *     conversation after each completed turn (create-on-first-turn, then patch);
 *   - generic tool rendering: any registry tool result is summarised;
 *   - a sensitive-tool confirmation card that executes via POST /partners/mcp
 *     on the user's explicit approval (the model never self-confirms).
 *
 * UX additions:
 *   - Stop: a stop button replaces the send button while the model is working
 *     (streaming or reasoning) so the partner can interrupt a long turn.
 *   - Retry: an inline "Retry" button appears when a turn errors, calling
 *     `regenerate()`. The backend also retries construction once.
 *   - Photo attachments: the partner can attach images, a few at a time across
 *     several messages, and later ask for a product to be built from them. Each
 *     upload goes into the partner's own assistant media folder (so it stays
 *     findable after the chat), and the model is told the photo EXISTS — name,
 *     type, url — but never receives pixels; looking is a deliberate act
 *     (`describe_image`).
 *   - Context window: a rough token estimate is tracked across the thread;
 *     near the limit a banner offers "Compact summary" (POST .../summarize),
 *     which replaces the older turns with a short summary so the chat keeps
 *     going without exceeding the model's context budget.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Button, Text, IconButton, toast, Tooltip, Label, Kbd } from "@medusajs/ui"
import { Sparkles, ArrowUpMini, Check, ExclamationCircle, XMarkMini, PaperClip, ArrowPathMini, TrianglesMini } from "@medusajs/icons"

import { sdk, backendUrl } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"
import {
  conversationsQueryKeys,
  type StoredMessage,
} from "../../../hooks/api/assistant-conversations"
import { runPartnerMcpTool } from "../../../lib/assistant-mcp"
import { Markdown } from "./markdown"
import { ToolData } from "./tool-data"

const jwtTokenStorageKey = __JWT_TOKEN_STORAGE_KEY__ || "partner_ui_auth_token"

type ChatThreadProps = {
  /** Existing conversation id, or null for a fresh unsaved chat. */
  conversationId: string | null
  /** Messages to seed the thread with (empty for a new chat). */
  initialMessages: StoredMessage[]
  /** Fired once, when a fresh chat is first persisted (gets its server id). */
  onCreated: (id: string, title: string) => void
  /** Fired after a context compaction replaces the stored history. */
  onCompacted?: () => void
}

/** A photo the partner attached, already uploaded to their assistant folder. */
type Attachment = {
  url: string
  name: string
  mime_type: string
  media_id?: string
}

/** Images only — the assistant's vision path can do nothing with anything else,
 *  and a file it cannot read is worse than one it refuses, because it will
 *  cheerfully describe a photo it never saw. */
const ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
/** Per message. The backend enforces its own cap independently. */
const MAX_ATTACHMENTS = 8

/**
 * Upload photos into the partner's own assistant folder and return the
 * references the chat route stores.
 *
 * Goes to /partners/assistant/attachments rather than the older
 * /partners/medias/uploads/* pair, which writes objects to the bucket ROOT with
 * no media record — an upload nothing can attribute once the chat is gone.
 */
async function uploadAttachments(
  files: File[],
  conversationKey: string,
  token: string | null
): Promise<Attachment[]> {
  const form = new FormData()
  for (const f of files) form.append("files", f)
  form.append("conversation_id", conversationKey)

  const res = await fetch(
    `${backendUrl.replace(/\/$/, "")}/partners/assistant/attachments`,
    {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    }
  )

  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(payload?.message || `Upload failed (${res.status})`)
  }

  const attachments: Attachment[] = (payload?.attachments ?? []).map((a: any) => ({
    url: a.url,
    name: a.name ?? "untitled",
    mime_type: a.type ?? "image/jpeg",
    media_id: a.media_id,
  }))
  if (!attachments.length) {
    throw new Error("Upload succeeded but returned no file")
  }
  return attachments
}

const SUGGESTIONS = [
  "Help me finish setting up my workspace",
  "How many orders do I have this week?",
  "Hide the customers menu from my sidebar",
  "What products am I selling?",
]

/**
 * Rough context budget the chat tries to stay under. The free-model rotator
 * ranks by context length and most free providers land in the 32k–128k range;
 * we warn early at 20k estimated tokens so there is headroom for tool output.
 * Conservative on purpose: this is an estimate, not a precise token count.
 */
const CONTEXT_WARN_TOKENS = 20000

function getText(parts: any[] | undefined): string {
  return (
    parts
      ?.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ") ?? ""
  )
}

/** First user message → conversation title (trimmed to a sane length). */
function deriveTitle(messages: any[]): string {
  const firstUser = messages.find((m) => m.role === "user")
  const text = getText(firstUser?.parts).trim()
  if (!text) return "New chat"
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

/** Reduce UI messages to the storable shape (id/role/parts). */
function toStored(messages: any[]): StoredMessage[] {
  return messages.map((m) => ({ id: m.id, role: m.role, parts: m.parts }))
}

/** Rough token estimate (~4 chars/token) across all text in a thread. */
function estimateTokens(messages: any[]): number {
  let chars = 0
  for (const m of messages) {
    const parts = m.parts ?? []
    for (const p of parts) {
      if (p?.type === "text" && typeof p.text === "string") chars += p.text.length
      else if (p?.type === "reasoning" && typeof p.text === "string") chars += p.text.length
      else if (p?.toolName) {
        // Tool calls carry input + output; count their JSON size.
        try {
          if (p.input) chars += JSON.stringify(p.input).length
          if (p.output) chars += JSON.stringify(p.output).length
        } catch {
          /* ignore */
        }
      }
    }
  }
  return Math.ceil(chars / 4)
}

export const ChatThread = ({
  conversationId,
  initialMessages,
  onCreated,
  onCompacted,
}: ChatThreadProps) => {
  const [input, setInput] = useState("")
  const [compacting, setCompacting] = useState(false)
  const [showContextBanner, setShowContextBanner] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const idRef = useRef<string | null>(conversationId)
  // Seed with the loaded thread's snapshot so opening a saved conversation
  // doesn't fire a redundant PATCH before the partner has said anything.
  const lastPersistedRef = useRef<string>(
    JSON.stringify(initialMessages.map((m: any) => [m.id, m.parts?.length]))
  )
  const persistingRef = useRef(false)

  // Photos held for the NEXT send, and the ones already sent this session.
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingAttachmentsRef = useRef<Attachment[]>([])

  // Stable key tying this thread's uploads to its chat turns. The server
  // recovers a conversation's photos by matching this against the
  // `conversation_id` stamped on each upload, so the SAME value must reach both
  // the upload route and `body.id` on the chat request — hence an explicit id
  // rather than the one useChat would generate internally.
  const threadKeyRef = useRef<string>(
    conversationId ??
      `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  )

  const authToken = () =>
    (sdk as any).client?.token ||
    (typeof window !== "undefined"
      ? localStorage.getItem(jwtTokenStorageKey)
      : null)

  const transport = new DefaultChatTransport({
    api: `${backendUrl.replace(/\/$/, "")}/partners/assistant/chat`,
    credentials: "include",
    headers: () => {
      const token = authToken()
      return token ? { Authorization: `Bearer ${token}` } : {}
    },
    // Returning a `body` REPLACES the SDK's default wholesale, so `id`,
    // `trigger` and `messageId` have to be spread back in by hand — only
    // api/headers/credentials/body are read from here.
    prepareSendMessagesRequest: ({
      body,
      messages,
      id,
      trigger,
      messageId,
    }: any) => {
      const pending = pendingAttachmentsRef.current
      pendingAttachmentsRef.current = []
      return {
        body: {
          ...body,
          id,
          messages,
          trigger,
          messageId,
          ...(pending.length ? { attachments: pending } : {}),
        },
      }
    },
  })

  const { messages, sendMessage, setMessages, status, error, stop, regenerate, clearError } = useChat({
    id: threadKeyRef.current,
    transport,
    messages: initialMessages as any,
  })

  const streaming = status === "submitted" || status === "streaming"
  const tokenEstimate = useMemo(() => estimateTokens(messages as any[]), [messages])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, status])

  // Surface the context banner once the estimate crosses the threshold.
  useEffect(() => {
    setShowContextBanner(tokenEstimate >= CONTEXT_WARN_TOKENS)
  }, [tokenEstimate])

  // Persist the thread after each completed turn. Create-on-first-turn, then
  // patch. A ref-guarded snapshot avoids redundant writes and re-entrancy.
  useEffect(() => {
    if (status !== "ready" || messages.length === 0) return
    const snapshot = JSON.stringify(messages.map((m: any) => [m.id, m.parts?.length]))
    if (snapshot === lastPersistedRef.current || persistingRef.current) return

    persistingRef.current = true
    const stored = toStored(messages as any[])
    const run = async () => {
      try {
        if (idRef.current) {
          await sdk.client.fetch(
            `/partners/assistant/conversations/${idRef.current}`,
            { method: "PATCH", body: { messages: stored } }
          )
        } else {
          const title = deriveTitle(messages as any[])
          const { conversation } = await sdk.client.fetch<{
            conversation: { id: string; title: string }
          }>("/partners/assistant/conversations", {
            method: "POST",
            body: { title, messages: stored },
          })
          idRef.current = conversation.id
          onCreated(conversation.id, conversation.title)
        }
        lastPersistedRef.current = snapshot
        queryClient.invalidateQueries({
          queryKey: conversationsQueryKeys.lists(),
        })
      } catch {
        // Non-fatal: the chat still works, history just didn't save this turn.
      } finally {
        persistingRef.current = false
      }
    }
    void run()
  }, [status, messages, onCreated])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // A message carrying only photos is legitimate — "here are three more" is a
    // complete turn when the partner is uploading a batch at a time.
    if ((!input.trim() && attachments.length === 0) || status !== "ready") return
    clearError?.()
    if (attachments.length) {
      pendingAttachmentsRef.current = attachments
      setAttachments([])
    }
    sendMessage({
      text: input.trim() || "I've shared some photos.",
    })
    setInput("")
  }

  /** Validate, upload, and hold photos for the next send. */
  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      const picked = Array.from(fileList ?? [])
      if (!picked.length) return

      const room = MAX_ATTACHMENTS - attachments.length
      if (room <= 0) {
        toast.error(`You can attach up to ${MAX_ATTACHMENTS} photos per message.`)
        return
      }

      const accepted: File[] = []
      for (const file of picked.slice(0, room)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name} isn't an image.`)
          continue
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          toast.error(
            `${file.name} is too large (max ${Math.round(
              MAX_ATTACHMENT_BYTES / (1024 * 1024)
            )}MB).`
          )
          continue
        }
        accepted.push(file)
      }
      if (picked.length > room) {
        toast.error(
          `Only the first ${room} photo(s) were attached — the limit is ${MAX_ATTACHMENTS} per message.`
        )
      }
      if (!accepted.length) return

      setUploading(true)
      try {
        const uploaded = await uploadAttachments(
          accepted,
          threadKeyRef.current,
          authToken()
        )
        setAttachments((prev) => [...prev, ...uploaded])
      } catch (err: any) {
        toast.error(`Could not attach: ${err?.message ?? "upload failed"}`)
      } finally {
        setUploading(false)
      }
    },
    [attachments.length]
  )

  const removeAttachment = (url: string) =>
    setAttachments((prev) => prev.filter((a) => a.url !== url))

  const handleStop = () => {
    try {
      stop()
    } catch {
      /* stop is best-effort */
    }
  }

  const handleRetry = () => {
    clearError?.()
    try {
      regenerate()
    } catch {
      toast.error("Could not retry. Please send the message again.")
    }
  }

  /**
   * Context compaction: ask the backend to roll the older turns into a short
   * summary, then replace the whole thread with [summary]. The recent turn
   * the partner just made is included in the summary inputs so continuity is
   * preserved; the client persists the trimmed conversation afterwards.
   */
  const handleCompact = useCallback(async () => {
    if (compacting || messages.length < 2) return
    setCompacting(true)
    try {
      const token =
        (sdk as any).client?.token ||
        (typeof window !== "undefined"
          ? localStorage.getItem(jwtTokenStorageKey)
          : null)
      const { summary } = await fetch(
        `${backendUrl.replace(/\/$/, "")}/partners/assistant/summarize`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ messages: toStored(messages as any[]) }),
        }
      ).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Summarize failed")
        return r.json()
      })
      if (!summary) throw new Error("No summary returned")

      // Replace the thread with a single assistant summary message. The
      // persist effect will write it back on the next ready tick.
      const summaryMessage = {
        id: `summary-${Date.now()}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `**Summary so far**\n\n${summary}`,
          },
        ],
      }
      setMessages?.([summaryMessage] as any)
      try {
        if (idRef.current) {
          await sdk.client.fetch(
            `/partners/assistant/conversations/${idRef.current}`,
            { method: "PATCH", body: { messages: toStored([summaryMessage]) } }
          )
          lastPersistedRef.current = JSON.stringify([
            [summaryMessage.id, summaryMessage.parts.length],
          ])
          queryClient.invalidateQueries({
            queryKey: conversationsQueryKeys.lists(),
          })
          onCompacted?.()
          toast.success("Chat compacted — older messages were summarized.")
        }
      } catch {
        // Non-fatal: the in-memory thread is already compacted.
      }
      setShowContextBanner(false)
    } catch (e: any) {
      toast.error(e?.message || "Could not compact the chat. Try starting a new chat instead.")
    } finally {
      setCompacting(false)
    }
  }, [compacting, messages, setMessages, onCompacted])

  return (
    <div className="flex flex-col h-full min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0"
      >
        {messages.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-y-3">
            <Sparkles className="text-ui-fg-subtle" />
            <Text size="small" className="text-ui-fg-subtle max-w-sm">
              I can help you set up and run your workspace — onboarding, layout,
              and questions about your orders, products and designs.
            </Text>
            <div className="flex flex-col gap-y-1.5 mt-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs text-ui-fg-subtle hover:text-ui-fg-base bg-ui-bg-subtle hover:bg-ui-bg-base-hover rounded-md px-3 py-1.5 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m: any) => (
          <MessageRow key={m.id} message={m} />
        ))}

        {streaming && (
          <div className="flex items-center gap-x-1 px-2">
            <span className="h-2 w-2 bg-ui-fg-muted rounded-full animate-pulse" />
            <span className="h-2 w-2 bg-ui-fg-muted rounded-full animate-pulse [animation-delay:0.2s]" />
            <span className="h-2 w-2 bg-ui-fg-muted rounded-full animate-pulse [animation-delay:0.4s]" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-x-2 px-2">
            <Text size="small" className="text-ui-tag-red-text">
              Something went wrong.
            </Text>
            <Button
              size="small"
              variant="secondary"
              onClick={handleRetry}
              className="!py-1 !px-2"
            >
              <ArrowPathMini />
              Retry
            </Button>
          </div>
        )}

        {showContextBanner && !compacting && (
          <div className="flex items-start gap-x-2 rounded-lg border border-ui-tag-orange-border bg-ui-tag-orange-bg px-3 py-2">
            <TrianglesMini className="text-ui-tag-orange-icon mt-0.5 shrink-0" />
            <div className="space-y-1.5">
              <Text size="xsmall" className="text-ui-tag-orange-text block">
                This chat is getting long and may exceed the model's context
                window — the assistant can start to "forget" earlier messages.
              </Text>
              <div className="flex items-center gap-x-2">
                <Button
                  size="small"
                  variant="secondary"
                  onClick={handleCompact}
                >
                  <ArrowPathMini />
                  Compact summary
                </Button>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Or start a new chat to keep responses fast.
                </Text>
              </div>
            </div>
          </div>
        )}
      </div>

      {attachments.length > 0 && (
        <div className="border-t border-ui-border-base px-3 pt-3 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div
              key={a.url}
              className="flex items-center gap-x-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle px-2 py-1"
            >
              <img
                src={a.url}
                alt={a.name}
                className="h-8 w-8 rounded object-cover"
              />
              <Text size="xsmall" className="max-w-[10rem] truncate">
                {a.name}
              </Text>
              <IconButton
                type="button"
                size="small"
                variant="transparent"
                aria-label={`Remove ${a.name}`}
                onClick={() => removeAttachment(a.url)}
              >
                <XMarkMini />
              </IconButton>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={`border-ui-border-base p-3 flex items-end gap-x-2 ${
          attachments.length > 0 ? "" : "border-t"
        }`}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e as any)
            }
          }}
          rows={1}
          placeholder="Ask the assistant…"
          className="flex-1 resize-none rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-2 text-sm focus:outline-none focus:border-ui-border-interactive max-h-32"
        />
        {/* Photos go into the partner's own assistant media folder, so they are
            still findable after the chat ends. */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files)
            // Reset so picking the SAME file twice still fires onChange.
            e.target.value = ""
          }}
        />
        <Tooltip
          content={
            attachments.length >= MAX_ATTACHMENTS
              ? `Up to ${MAX_ATTACHMENTS} photos per message`
              : "Attach photos"
          }
          side="top"
        >
          <IconButton
            type="button"
            size="large"
            aria-label="Attach photos"
            isLoading={uploading}
            disabled={uploading || attachments.length >= MAX_ATTACHMENTS}
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperClip />
          </IconButton>
        </Tooltip>
        {streaming ? (
          <IconButton
            type="button"
            size="large"
            onClick={handleStop}
            aria-label="Stop generating"
            className="text-ui-tag-red-icon"
          >
            <XMarkMini />
          </IconButton>
        ) : (
          <IconButton
            type="submit"
            size="large"
            disabled={
              (!input.trim() && attachments.length === 0) || status !== "ready"
            }
            aria-label="Send message"
          >
            <ArrowUpMini />
          </IconButton>
        )}
      </form>
      <div className="px-3 pb-2 flex items-center justify-between">
        <Text size="xsmall" className="text-ui-fg-muted">
          <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line
        </Text>
        <Label size="xsmall" className="text-ui-fg-muted">
          ~{tokenEstimate.toLocaleString()} tokens
        </Label>
      </div>
    </div>
  )
}

function MessageRow({ message: m }: { message: any }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-ui-bg-highlight rounded-lg rounded-br-sm px-3 py-2 max-w-[85%]">
          <Text size="small" className="whitespace-pre-wrap">
            {getText(m.parts)}
          </Text>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {m.parts?.map((part: any, i: number) => {
        if (part.type === "reasoning") {
          return part.text ? <ReasoningBlock key={i} text={part.text} /> : null
        }
        if (part.type === "text" && part.text) {
          return (
            <div
              key={i}
              className="bg-ui-bg-subtle rounded-lg rounded-bl-sm px-3 py-2 max-w-[95%]"
            >
              <Markdown content={part.text} />
            </div>
          )
        }
        // Tool parts: `tool-<name>` (typed) or `dynamic-tool` (name in toolName).
        if (part.type?.startsWith("tool-") || part.type === "dynamic-tool") {
          const name =
            part.type === "dynamic-tool"
              ? part.toolName
              : part.type.slice("tool-".length)
          return (
            <ToolCard
              key={part.toolCallId || i}
              name={name}
              input={part.input}
              output={part.output}
              state={part.state}
            />
          )
        }
        return null
      })}
    </div>
  )
}

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
        <Text
          size="xsmall"
          className="block mt-1 ml-3 italic opacity-70 whitespace-pre-wrap"
        >
          {text}
        </Text>
      )}
    </div>
  )
}

function PlanSummary({ plan }: { plan: any }) {
  if (!plan || typeof plan !== "object") return null
  return (
    <div className="font-mono text-[11px] text-ui-fg-subtle break-all">
      <span className="uppercase">{String(plan.method || "")}</span>{" "}
      {String(plan.path || "")}
      {plan.body ? (
        <div className="mt-1 opacity-80">{JSON.stringify(plan.body)}</div>
      ) : null}
    </div>
  )
}

/**
 * Renders a single tool call. Sensitive tools come back with
 * `requires_confirmation` and get an Approve card that executes via MCP.
 */
function ToolCard({
  name,
  input,
  output,
  state,
}: {
  name: string
  input: any
  output: any
  state?: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [resolved, setResolved] = useState<null | "approved" | "rejected">(null)
  const [result, setResult] = useState<any>(output)

  const label = name?.replace(/_/g, " ")

  const onApprove = useCallback(async () => {
    setConfirming(true)
    try {
      const r = await runPartnerMcpTool(name, (input as any) || {})
      setResult(r)
      setResolved("approved")
      if (r.ok) {
        toast.success(`Done: ${label}`)
      } else {
        toast.error(r.error || `Could not run ${label}`)
      }
    } catch (e: any) {
      toast.error(e?.message || `Could not run ${label}`)
    } finally {
      setConfirming(false)
    }
  }, [name, input, label])

  // Still streaming the tool input / awaiting execution.
  if (state && state !== "output-available" && state !== "output-error") {
    return (
      <div className="border border-ui-border-base rounded-lg px-3 py-2 bg-ui-bg-base flex items-center gap-x-2">
        <Sparkles className="text-ui-fg-muted" />
        <Text size="xsmall" className="text-ui-fg-subtle">
          Running <span className="font-medium">{label}</span>…
        </Text>
      </div>
    )
  }

  const out = result || output

  // Sensitive gate — show an approval card (unless already resolved here).
  if (out?.requires_confirmation && resolved !== "approved") {
    return (
      <div className="border border-ui-tag-orange-border rounded-lg p-3 bg-ui-tag-orange-bg space-y-2">
        <div className="flex items-center gap-x-1.5">
          <ExclamationCircle className="text-ui-tag-orange-icon" />
          <Text size="xsmall" weight="plus" className="text-ui-tag-orange-text">
            Confirm: {label}
          </Text>
        </div>
        {out.warning && (
          <Text size="xsmall" className="text-ui-fg-subtle">
            {out.warning}
          </Text>
        )}
        <PlanSummary plan={out.plan} />
        {resolved === "rejected" ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            Cancelled.
          </Text>
        ) : (
          <div className="flex justify-end gap-x-2 pt-1">
            <Button
              size="small"
              variant="secondary"
              onClick={() => setResolved("rejected")}
              disabled={confirming}
            >
              Cancel
            </Button>
            <Button size="small" onClick={onApprove} isLoading={confirming}>
              Approve &amp; run
            </Button>
          </div>
        )}
      </div>
    )
  }

  // Executed (or a dry-run preview / read result) — status line + any data.
  const ok = out?.ok !== false
  const hasData = ok && out?.data != null && !out?.dry_run
  return (
    <div className="border border-ui-border-base rounded-lg px-3 py-2 bg-ui-bg-base space-y-2">
      <div className="flex items-center gap-x-1.5">
        {ok ? (
          <Check className="text-ui-tag-green-icon" />
        ) : (
          <ExclamationCircle className="text-ui-tag-red-icon" />
        )}
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle capitalize">
          {out?.dry_run ? "Preview" : ok ? label : `Failed: ${label}`}
        </Text>
      </div>
      {out?.error && (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {out.error}
        </Text>
      )}
      {out?.dry_run && <PlanSummary plan={out.plan} />}
      {hasData && <ToolData data={out.data} />}
    </div>
  )
}
