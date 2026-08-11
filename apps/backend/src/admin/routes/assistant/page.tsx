/**
 * Admin Assistant (#1092) — an agentic chat that drives the Admin API through
 * the shared MCP tool registry.
 *
 * Streaming chat wired to POST /admin/assistant/chat (admin session auth). The
 * model grounds with get_admin_stats and answers operational questions using
 * the Tier-1 read tools; write/dangerous tiers (later) surface an approval card
 * that executes via POST /admin/mcp with confirm:true (+ reason) on the
 * operator's explicit approval — the model never self-confirms.
 *
 * This lives alongside the legacy V4 hybrid-resolver chat (routes/chats) rather
 * than replacing it, per the epic's one-release deprecation window.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChatBubbleLeftRight, Sparkles, ArrowUpMini, Spinner, Check, ExclamationCircle, ArrowPathMini, SquareTwoStack, Plus, Trash, Photo } from "@medusajs/icons"
import { Container, Heading, Text, Button, Textarea, IconButton, Badge, Table, toast } from "@medusajs/ui"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { API_BASE_URL } from "../../lib/config"
import { runAdminMcpTool, type AdminToolResult } from "../../lib/assistant-mcp"
import { Markdown } from "../../components/markdown"

const SUGGESTIONS = [
  "Give me a snapshot of the platform",
  "How many orders came in recently?",
  "List the most recent partners",
  "What production runs are open?",
]

/** An uploaded image the operator attached to the next message. */
type Attachment = {
  url: string
  name: string
  mime_type: string
}

/** Images only, and small enough that a vision model can actually read it. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENTS = 4

/**
 * Upload one image and return the reference the chat route stores.
 *
 * Goes through /admin/medias (multipart), which base64-encodes the content —
 * the path that must never regress to latin1, or every image ≥ 0x80 arrives
 * corrupted and unreadable by any vision model (#769/#789).
 */
async function uploadAttachment(file: File): Promise<Attachment> {
  const form = new FormData()
  form.append("files", file)

  const res = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/admin/medias`, {
    method: "POST",
    credentials: "include",
    body: form,
  })

  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(payload?.message || `Upload failed (${res.status})`)
  }

  // The media workflow returns { result: { mediaFiles: [...] } }; be defensive
  // about the exact nesting rather than assuming one shape.
  const files: any[] =
    payload?.result?.mediaFiles ??
    payload?.result?.media_files ??
    (Array.isArray(payload?.result) ? payload.result : [])
  const url = files?.[0]?.url ?? files?.[0]?.file_path
  if (!url) {
    throw new Error("Upload succeeded but returned no url")
  }

  return { url, name: file.name, mime_type: file.type || "image/*" }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

/** Find the array a list tool returned (top-level or one level in). */
function findRows(data: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(data) && data.every(isRecord)) return data as Record<string, unknown>[]
  if (isRecord(data)) {
    for (const v of Object.values(data)) {
      if (Array.isArray(v) && v.every(isRecord)) return v as Record<string, unknown>[]
    }
  }
  return null
}

const PREFERRED = ["display_id", "title", "name", "handle", "email", "status", "created_at"]

/** Compact table for a list tool's rows; falls back to key/value or raw JSON. */
const ToolData = ({ data }: { data: unknown }) => {
  const rows = findRows(data)
  if (rows && rows.length) {
    const keys = Array.from(
      new Set([
        ...PREFERRED.filter((k) => k in rows[0]),
        ...Object.keys(rows[0]).filter((k) => k !== "id" && k !== "metadata"),
      ])
    ).slice(0, 6)
    return (
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              {keys.map((k) => (
                <Table.HeaderCell key={k}>{k}</Table.HeaderCell>
              ))}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.slice(0, 10).map((r, i) => (
              <Table.Row key={i}>
                {keys.map((k) => (
                  <Table.Cell key={k}>{formatCell(r[k])}</Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {rows.length > 10 ? (
          <Text size="xsmall" className="text-ui-fg-muted mt-1">
            +{rows.length - 10} more
          </Text>
        ) : null}
      </div>
    )
  }
  if (isRecord(data)) {
    return (
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {Object.entries(data)
          .slice(0, 12)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <Text size="xsmall" className="text-ui-fg-muted">
                {k}
              </Text>
              <Text size="xsmall">{formatCell(v)}</Text>
            </div>
          ))}
      </div>
    )
  }
  return (
    <pre className="text-ui-fg-subtle whitespace-pre-wrap text-xs">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function formatCell(v: unknown): string {
  if (v == null) return "—"
  if (typeof v === "object") return Array.isArray(v) ? `[${v.length}]` : "{…}"
  return String(v)
}

/** Control keys the confirm bridge re-stamps itself — never re-send from input. */
const CONTROL_ARGS = new Set(["confirm", "reason", "dry_run"])

/** Strip control keys from the model's tool-call input for a real re-run. */
function toolCallArgs(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter(([k]) => !CONTROL_ARGS.has(k))
  )
}

/** Readable one-line plan: METHOD path (+ body/query preview). */
const PlanSummary = ({ plan }: { plan: unknown }) => {
  if (!isRecord(plan)) return null
  const { method, path, body, query } = plan as Record<string, unknown>
  return (
    <div className="border-ui-border-base bg-ui-bg-base rounded-md border px-2.5 py-2">
      <div className="flex items-center gap-2 font-mono text-xs">
        {method ? (
          <Badge size="2xsmall" color={method === "DELETE" ? "red" : "grey"}>
            {String(method)}
          </Badge>
        ) : null}
        <span className="text-ui-fg-subtle break-all">{String(path ?? "")}</span>
      </div>
      {isRecord(body) && Object.keys(body).length ? (
        <div className="mt-2">
          <Text size="xsmall" className="text-ui-fg-muted mb-1">
            Changes
          </Text>
          <ToolData data={body} />
        </div>
      ) : null}
      {isRecord(query) && Object.keys(query).length ? (
        <div className="mt-2">
          <Text size="xsmall" className="text-ui-fg-muted mb-1">
            Filters
          </Text>
          <ToolData data={query} />
        </div>
      ) : null}
    </div>
  )
}

/** One tool part: activity line + rendered result or approval card. */
const ToolPart = ({ part }: { part: any }) => {
  const toolName: string =
    part.type === "dynamic-tool"
      ? part.toolName
      : String(part.type || "").replace(/^tool-/, "")
  const output: AdminToolResult | undefined = part.output
  const running = part.state === "input-available" || part.state === "input-streaming"

  const [approving, setApproving] = useState(false)
  const [reason, setReason] = useState("")
  const [approved, setApproved] = useState<AdminToolResult | null>(null)
  const [cancelled, setCancelled] = useState(false)

  const guarded = !!output && (output.requires_confirmation || output.requires_reason)
  const result = approved ?? output

  const approve = async () => {
    if (output?.requires_reason && !reason.trim()) {
      toast.error("A reason is required for this action.")
      return
    }
    setApproving(true)
    try {
      // Re-issue the model's ORIGINAL tool-call arguments (they carry path
      // params like an id — `plan.body` does not), letting the confirm bridge
      // add confirm:true (+ reason). Anything less drops path params and the
      // backend fails with "Missing required parameter".
      const res = await runAdminMcpTool(
        toolName,
        toolCallArgs(part.input),
        { reason: reason.trim() || undefined }
      )
      setApproved(res)
      if (res.ok) toast.success(`${toolName} completed.`)
      else toast.error(res.error || `${toolName} failed.`)
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="border-ui-border-base bg-ui-bg-subtle mt-2 rounded-lg border p-3">
      <div className="mb-1 flex items-center gap-2">
        {running ? <Spinner className="animate-spin" /> : <Sparkles />}
        <Text size="small" weight="plus">
          {toolName}
        </Text>
        {result?.dry_run ? <Badge size="2xsmall" color="blue">preview</Badge> : null}
        {result && !result.dry_run && result.ok && !guarded ? (
          <Badge size="2xsmall" color="green">done</Badge>
        ) : null}
        {result && !result.ok ? <Badge size="2xsmall" color="red">error</Badge> : null}
      </div>

      {guarded && !approved ? (
        cancelled ? (
          <Text size="small" className="text-ui-fg-muted mt-1">
            Cancelled — nothing ran.
          </Text>
        ) : (
          <div className="mt-1">
            <div className="mb-2 flex items-start gap-2">
              <ExclamationCircle className="text-ui-tag-orange-icon mt-0.5" />
              <Text size="small">
                {output?.warning || "This action needs your approval before it runs."}
              </Text>
            </div>
            {output?.plan ? <PlanSummary plan={output.plan} /> : null}
            {output?.current !== undefined ? (
              <div className="mt-2">
                <Text size="xsmall" className="text-ui-fg-muted mb-1">
                  Current
                </Text>
                <ToolData data={output.current} />
              </div>
            ) : null}
            {output?.requires_reason ? (
              <Textarea
                placeholder="Reason (why are you doing this?) — audited"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-2 mb-2"
              />
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              <Button size="small" variant="danger" isLoading={approving} onClick={approve}>
                <Check /> Approve &amp; run
              </Button>
              <Button
                size="small"
                variant="secondary"
                disabled={approving}
                onClick={() => setCancelled(true)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )
      ) : result?.data !== undefined ? (
        <ToolData data={result.data} />
      ) : result?.error ? (
        <Text size="small" className="text-ui-fg-error">
          {result.error}
        </Text>
      ) : null}
    </div>
  )
}

const getText = (parts: any[] | undefined): string =>
  (parts || [])
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("")

/** Copy-to-clipboard affordance for an assistant answer. */
const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy to clipboard.")
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="text-ui-fg-muted hover:text-ui-fg-base mt-1 flex items-center gap-1 text-xs transition-colors"
      aria-label="Copy message"
    >
      {copied ? <Check className="h-3 w-3" /> : <SquareTwoStack className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

// ─── Conversation persistence (history) ──────────────────────────────────────

type ConversationSummary = {
  id: string
  title: string
  created_at?: string
  updated_at?: string
}

type StoredMessage = { id: string; role: string; parts: any[] }

const CONVERSATIONS_URL = `${API_BASE_URL.replace(/\/$/, "")}/admin/assistant/conversations`

/** Admin session cookie authenticates; small typed fetch wrapper. */
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
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

/**
 * Rough context budget the thread tries to stay under (#1238). Admin threads
 * carry every tool call's input AND its JSON result, so they reach the ceiling
 * markedly faster than the same number of partner turns — we warn at 20k
 * estimated tokens to leave headroom for the next tool's output.
 *
 * Deliberately an estimate, not a count: the provider's real usage figure only
 * arrives after a request, and the point is to warn BEFORE sending one.
 */
const CONTEXT_WARN_TOKENS = 20000

/** Rough token estimate (~4 chars/token) across a thread, tool payloads included. */
function estimateTokens(messages: any[]): number {
  let chars = 0
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p?.type === "text" && typeof p.text === "string") chars += p.text.length
      else if (p?.type === "reasoning" && typeof p.text === "string") chars += p.text.length
      else if (p?.toolName) {
        try {
          if (p.input) chars += JSON.stringify(p.input).length
          if (p.output) chars += JSON.stringify(p.output).length
        } catch {
          /* a non-serialisable payload just doesn't count toward the estimate */
        }
      }
    }
  }
  return Math.ceil(chars / 4)
}

/**
 * Turn whatever `useChat` surfaced into something an operator can act on.
 *
 * A single "the assistant hit an error" line is useless when the real cause is
 * an expired admin session or one failing tool — the operator retries forever
 * against a problem retrying cannot fix. Transport/auth faults are separated
 * from model faults so the message can say what to actually do.
 */
function describeChatError(error: unknown): { title: string; detail?: string; retryable: boolean } {
  const raw = (error as any)?.message ? String((error as any).message) : ""

  if (/\b401\b|unauthor/i.test(raw)) {
    return {
      title: "Your admin session expired.",
      detail: "Reload the page to sign in again — retrying won't help until you do.",
      retryable: false,
    }
  }
  if (/\b503\b|not configured/i.test(raw)) {
    return {
      title: "The admin assistant isn't configured.",
      detail:
        "Add a platform with role ai_admin_assistant under Settings → External Platforms, or set OPENROUTER_API_KEY.",
      retryable: false,
    }
  }
  if (/\b429\b|rate limit/i.test(raw)) {
    return {
      title: "The model is rate-limited.",
      detail: "Wait a moment before retrying.",
      retryable: true,
    }
  }
  if (/failed to fetch|network|ECONN/i.test(raw)) {
    return {
      title: "Couldn't reach the server.",
      detail: "Check your connection, then retry.",
      retryable: true,
    }
  }
  return {
    title: "The assistant hit an error.",
    detail: raw || undefined,
    retryable: true,
  }
}

/** Tool calls that came back as errors, so the UI can name them. */
function failedToolNames(messages: any[]): string[] {
  const names = new Set<string>()
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (!p?.toolName) continue
      const out: any = p.output
      const errored =
        p.state === "output-error" ||
        p.errorText ||
        (out && typeof out === "object" && (out.error || out.ok === false))
      if (errored) names.add(String(p.toolName))
    }
  }
  return [...names]
}

const AssistantChat = ({
  conversationId,
  initialMessages,
  onCreated,
}: {
  conversationId: string | null
  initialMessages: StoredMessage[]
  onCreated: (id: string, title: string) => void
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState("")
  const idRef = useRef<string | null>(conversationId)
  const persistingRef = useRef(false)
  const lastPersistedRef = useRef<string>(
    JSON.stringify(initialMessages.map((m) => [m.id, m.parts?.length]))
  )

  // Attachments for the turn currently being sent. A ref, not state, because
  // the transport closure is built once and must read the value at send time —
  // and because clearing it must not race the re-render that follows send.
  const pendingAttachmentsRef = useRef<Attachment[]>([])

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE_URL.replace(/\/$/, "")}/admin/assistant/chat`,
        credentials: "include",
        // The callback's `body` is ONLY the extra body option — `messages`, `id`,
        // `trigger` and `messageId` arrive as siblings of it, and returning a
        // `body` replaces the SDK's default wholesale. So they have to be spread
        // back in by hand; spreading them at the top level instead drops them,
        // because only `api`/`headers`/`credentials`/`body` are read from here.
        prepareSendMessagesRequest: ({
          body,
          messages,
          id,
          trigger,
          messageId,
        }: any) => {
          const attachments = pendingAttachmentsRef.current
          pendingAttachmentsRef.current = []
          return {
            body: {
              ...body,
              id,
              messages,
              trigger,
              messageId,
              ...(attachments.length ? { attachments } : {}),
            },
          }
        },
      }),
    []
  )

  const { messages, setMessages, sendMessage, status, error, stop, regenerate, clearError } =
    useChat({ transport, messages: initialMessages as any })
  const streaming = status === "submitted" || status === "streaming"

  const [autoScroll, setAutoScroll] = useState(true)
  const [queued, setQueued] = useState<string[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [compacting, setCompacting] = useState(false)
  const tokenEstimate = useMemo(() => estimateTokens(messages as any[]), [messages])
  const overBudget = tokenEstimate >= CONTEXT_WARN_TOKENS

  const retry = () => {
    clearError?.()
    try {
      regenerate()
    } catch {
      toast.error("Could not retry. Please send the message again.")
    }
  }

  /**
   * Follow the stream only while the operator is actually at the bottom.
   *
   * Auto-scroll used to be unconditional, so reading back through a long tool
   * result mid-answer yanked you to the end on every token. Scrolling away now
   * releases the thread; returning to the bottom re-attaches it, and the toggle
   * turns the whole behaviour off.
   */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setAutoScroll(atBottom)
  }, [])

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, status, autoScroll])

  // Persist the thread after each completed turn: create-on-first-turn, then
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
          await apiFetch(`${CONVERSATIONS_URL}/${idRef.current}`, {
            method: "PATCH",
            body: JSON.stringify({ messages: stored }),
          })
        } else {
          const title = deriveTitle(messages as any[])
          const { conversation } = await apiFetch<{
            conversation: { id: string; title: string }
          }>(CONVERSATIONS_URL, {
            method: "POST",
            body: JSON.stringify({ title, messages: stored }),
          })
          idRef.current = conversation.id
          onCreated(conversation.id, conversation.title)
        }
        lastPersistedRef.current = snapshot
      } catch {
        // Non-fatal: the chat still works, history just didn't save this turn.
      } finally {
        persistingRef.current = false
      }
    }
    void run()
  }, [status, messages, onCreated])

  /**
   * Queue instead of dropping. Typing a follow-up while the model is working
   * used to be silently discarded (`if (streaming) return`), which reads as the
   * UI ignoring you. Queued messages send in order as each turn finishes.
   */
  const submit = (text: string) => {
    const t = text.trim()
    // An image on its own IS a message — "here, file this" with no words is a
    // normal thing to do, so don't require text when something is attached.
    if (!t && attachments.length === 0) return
    setInput("")

    if (streaming) {
      // Queued turns carry text only. Sending the attachment now would attach it
      // to whichever turn happens to flush next, which is not the one the
      // operator was looking at when they picked the file.
      if (attachments.length) {
        toast.warning("Wait for the current answer before sending an attachment")
        return
      }
      setQueued((q) => [...q, t])
      return
    }

    if (attachments.length) {
      pendingAttachmentsRef.current = attachments
      setAttachments([])
    }
    sendMessage({ text: t || "(see attached)" })
  }

  /** Validate, upload, and hold images for the next send. */
  const attachFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      const picked = Array.from(files)

      const room = MAX_ATTACHMENTS - attachments.length
      if (room <= 0) {
        toast.error(`You can attach at most ${MAX_ATTACHMENTS} images per message`)
        return
      }

      const accepted: File[] = []
      for (const f of picked.slice(0, room)) {
        if (!f.type.startsWith("image/")) {
          toast.error(`${f.name} is not an image — only images can be attached`)
          continue
        }
        if (f.size > MAX_ATTACHMENT_BYTES) {
          toast.error(
            `${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is ${
              MAX_ATTACHMENT_BYTES / 1024 / 1024
            } MB`
          )
          continue
        }
        accepted.push(f)
      }
      if (!accepted.length) return

      setUploading(true)
      try {
        const settled = await Promise.allSettled(accepted.map(uploadAttachment))
        const ok = settled
          .filter((s): s is PromiseFulfilledResult<Attachment> => s.status === "fulfilled")
          .map((s) => s.value)
        settled
          .filter((s): s is PromiseRejectedResult => s.status === "rejected")
          .forEach((s) =>
            toast.error(`Could not attach: ${s.reason?.message ?? "upload failed"}`)
          )
        if (ok.length) setAttachments((a) => [...a, ...ok])
      } finally {
        setUploading(false)
      }
    },
    [attachments.length]
  )

  useEffect(() => {
    if (status !== "ready" || queued.length === 0 || error) return
    const [next, ...rest] = queued
    setQueued(rest)
    sendMessage({ text: next })
  }, [status, queued, error, sendMessage])

  /**
   * Context compaction: roll the older turns into a summary so a long thread can
   * continue instead of silently losing its head. Mirrors the partner assistant,
   * against POST /admin/assistant/summarize.
   */
  const compact = useCallback(async () => {
    if (compacting || messages.length < 2) return
    setCompacting(true)
    try {
      const { summary } = await apiFetch<{ summary: string }>(
        `${API_BASE_URL.replace(/\/$/, "")}/admin/assistant/summarize`,
        { method: "POST", body: JSON.stringify({ messages: toStored(messages as any[]) }) }
      )
      // Keep the last exchange verbatim — the operator is usually mid-thought in
      // it — and replace everything older with the summary.
      const tail = (messages as any[]).slice(-2)
      setMessages([
        {
          id: `summary-${Date.now()}`,
          role: "assistant",
          parts: [{ type: "text", text: `**Summary so far**\n\n${summary}` }],
        } as any,
        ...tail,
      ])
      toast.success("Chat compacted — older messages were summarized.")
    } catch (e: any) {
      toast.error(e?.message || "Could not compact the chat. Try starting a new chat instead.")
    } finally {
      setCompacting(false)
    }
  }, [compacting, messages, setMessages])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-4 overflow-y-auto px-6 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col gap-2">
            <Text size="small" className="text-ui-fg-muted">
              Try one of these:
            </Text>
            {SUGGESTIONS.map((s) => (
              <Button
                key={s}
                variant="secondary"
                size="small"
                className="w-fit"
                onClick={() => submit(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        ) : null}

        {messages.map((m: any) => {
          const text = getText(m.parts)
          const toolParts = (m.parts || []).filter(
            (p: any) =>
              p?.type === "dynamic-tool" || String(p?.type || "").startsWith("tool-")
          )
          return (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  m.role === "user"
                    ? "bg-ui-bg-interactive text-ui-fg-on-color max-w-[80%] rounded-lg px-3 py-2"
                    : "max-w-[92%]"
                }
              >
                {text ? (
                  m.role === "user" ? (
                    <Text size="small" className="whitespace-pre-wrap">
                      {text}
                    </Text>
                  ) : (
                    <>
                      <Markdown content={text} />
                      {!streaming ? <CopyButton text={text} /> : null}
                    </>
                  )
                ) : null}
                {toolParts.map((p: any, i: number) => (
                  <ToolPart key={p.toolCallId || i} part={p} />
                ))}
              </div>
            </div>
          )
        })}

        {streaming ? (
          <div className="text-ui-fg-muted flex items-center gap-2">
            <Spinner className="animate-spin" />
            <Text size="small">Thinking…</Text>
          </div>
        ) : null}

        {error ? (
          (() => {
            const described = describeChatError(error)
            const failed = failedToolNames(messages as any[])
            return (
              <div className="text-ui-fg-error flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <ExclamationCircle />
                  <Text size="small">{described.title}</Text>
                  {described.retryable ? (
                    <Button size="small" variant="secondary" onClick={retry}>
                      <ArrowPathMini /> Retry
                    </Button>
                  ) : null}
                </div>
                {described.detail ? (
                  <Text size="xsmall" className="text-ui-fg-subtle pl-6">
                    {described.detail}
                  </Text>
                ) : null}
                {failed.length ? (
                  <Text size="xsmall" className="text-ui-fg-subtle pl-6">
                    Failed {failed.length === 1 ? "tool" : "tools"}: {failed.join(", ")}
                  </Text>
                ) : null}
              </div>
            )
          })()
        ) : null}
      </div>

      <div className="border-ui-border-base border-t px-6 py-4">
        {overBudget ? (
          <div className="border-ui-border-base bg-ui-bg-subtle mb-3 flex items-center gap-2 rounded-md border px-3 py-2">
            <Text size="xsmall" className="text-ui-fg-subtle flex-1">
              This chat is getting long (~{tokenEstimate.toLocaleString()} tokens) and the
              assistant may start losing earlier context.
            </Text>
            <Button size="small" variant="secondary" isLoading={compacting} onClick={compact}>
              Compact summary
            </Button>
          </div>
        ) : null}
        {queued.length ? (
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <Text size="xsmall" className="text-ui-fg-muted">
              Queued:
            </Text>
            {queued.map((q, i) => (
              <Badge key={`${q}-${i}`} size="2xsmall" className="max-w-[240px] truncate">
                {q}
              </Badge>
            ))}
            <Button size="small" variant="transparent" onClick={() => setQueued([])}>
              Clear
            </Button>
          </div>
        ) : null}
        {attachments.length ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {attachments.map((a, i) => (
              <div
                key={`${a.url}-${i}`}
                className="border-ui-border-base bg-ui-bg-subtle flex items-center gap-2 rounded-md border px-2 py-1"
              >
                <img
                  src={a.url}
                  alt={a.name}
                  className="h-8 w-8 rounded object-cover"
                />
                <Text size="xsmall" className="max-w-[160px] truncate">
                  {a.name}
                </Text>
                <IconButton
                  size="2xsmall"
                  variant="transparent"
                  onClick={() =>
                    setAttachments((list) => list.filter((_, idx) => idx !== i))
                  }
                >
                  <Trash />
                </IconButton>
              </div>
            ))}
            <Text size="xsmall" className="text-ui-fg-muted">
              Attached, not read — ask me to read one if you need what's in it.
            </Text>
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void attachFiles(e.target.files)
              // Reset so picking the same file twice still fires onChange.
              e.target.value = ""
            }}
          />
          <IconButton
            variant="transparent"
            isLoading={uploading}
            disabled={uploading || attachments.length >= MAX_ATTACHMENTS}
            onClick={() => fileInputRef.current?.click()}
          >
            <Photo />
          </IconButton>
          <Textarea
            placeholder={
              streaming ? "Type to queue the next message…" : "Ask the admin assistant…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit(input)
              }
            }}
            rows={1}
            className="resize-none"
          />
          {streaming ? (
            <Button variant="secondary" onClick={() => stop()}>
              Stop
            </Button>
          ) : null}
          <IconButton
            variant="primary"
            disabled={!input.trim() && attachments.length === 0}
            onClick={() => submit(input)}
          >
            <ArrowUpMini />
          </IconButton>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <Text size="xsmall" className="text-ui-fg-muted">
            ~{tokenEstimate.toLocaleString()} tokens
          </Text>
          <Button
            size="small"
            variant="transparent"
            onClick={() => {
              const next = !autoScroll
              setAutoScroll(next)
              if (next && scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight
              }
            }}
          >
            {autoScroll ? "Following" : "Not following"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── History sidebar ─────────────────────────────────────────────────────────

const HistorySidebar = ({
  conversations,
  activeId,
  loading,
  onNew,
  onSelect,
  onDelete,
}: {
  conversations: ConversationSummary[]
  activeId: string | null
  loading: boolean
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}) => (
  <div className="border-ui-border-base flex w-64 shrink-0 flex-col border-r">
    <div className="border-ui-border-base border-b p-3">
      <Button variant="secondary" size="small" className="w-full" onClick={onNew}>
        <Plus /> New chat
      </Button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {loading ? (
        <Text size="xsmall" className="text-ui-fg-muted px-2 py-1">
          Loading…
        </Text>
      ) : conversations.length === 0 ? (
        <Text size="xsmall" className="text-ui-fg-muted px-2 py-1">
          No conversations yet.
        </Text>
      ) : (
        conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-1 rounded-md px-2 py-1.5 ${
              c.id === activeId ? "bg-ui-bg-base-pressed" : "hover:bg-ui-bg-base-hover"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className="text-ui-fg-subtle hover:text-ui-fg-base flex-1 truncate text-left text-sm"
              title={c.title}
            >
              {c.title}
            </button>
            <button
              type="button"
              onClick={() => onDelete(c.id)}
              className="text-ui-fg-muted hover:text-ui-fg-error opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Delete conversation"
            >
              <Trash className="h-3.5 w-3.5" />
            </button>
          </div>
        ))
      )}
    </div>
  </div>
)

// ─── Page (two-pane: history + chat) ─────────────────────────────────────────

const AssistantPage = () => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [initialMessages, setInitialMessages] = useState<StoredMessage[]>([])
  // Bumping this remounts <AssistantChat>, resetting useChat for a fresh thread
  // or a freshly-loaded conversation.
  const [threadKey, setThreadKey] = useState(0)

  const refreshList = useCallback(async () => {
    try {
      const { conversations } = await apiFetch<{
        conversations: ConversationSummary[]
      }>(CONVERSATIONS_URL)
      setConversations(conversations)
    } catch {
      // Non-fatal: the chat still works without the history list.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  const startNew = useCallback(() => {
    setActiveId(null)
    setInitialMessages([])
    setThreadKey((k) => k + 1)
  }, [])

  const openConversation = useCallback(async (id: string) => {
    try {
      const { conversation } = await apiFetch<{
        conversation: { id: string; messages: StoredMessage[] }
      }>(`${CONVERSATIONS_URL}/${id}`)
      setActiveId(id)
      setInitialMessages(conversation.messages || [])
      setThreadKey((k) => k + 1)
    } catch {
      toast.error("Could not open that conversation.")
    }
  }, [])

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`${CONVERSATIONS_URL}/${id}`, { method: "DELETE" })
        setConversations((prev) => prev.filter((c) => c.id !== id))
        if (id === activeId) startNew()
      } catch {
        toast.error("Could not delete that conversation.")
      }
    },
    [activeId, startNew]
  )

  const onCreated = useCallback(
    (id: string, title: string) => {
      setActiveId(id)
      setConversations((prev) => [
        { id, title },
        ...prev.filter((c) => c.id !== id),
      ])
    },
    []
  )

  return (
    <Container className="flex h-[calc(100vh-140px)] flex-col overflow-hidden p-0">
      <div className="border-ui-border-base flex items-center gap-2 border-b px-6 py-4">
        <Sparkles className="text-ui-fg-interactive" />
        <div>
          <Heading level="h2">Admin Assistant</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Ask about orders, partners, production and more — it reads the Admin API for you.
          </Text>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <HistorySidebar
          conversations={conversations}
          activeId={activeId}
          loading={loading}
          onNew={startNew}
          onSelect={openConversation}
          onDelete={deleteConversation}
        />
        <AssistantChat
          key={threadKey}
          conversationId={activeId}
          initialMessages={initialMessages}
          onCreated={onCreated}
        />
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Assistant",
  icon: ChatBubbleLeftRight,
})

export default AssistantPage
