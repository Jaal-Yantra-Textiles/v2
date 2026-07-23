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
import { ChatBubbleLeftRight, Sparkles, ArrowUpMini, Spinner, Check, ExclamationCircle, ArrowPathMini, SquareTwoStack, Plus, Trash } from "@medusajs/icons"
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

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE_URL.replace(/\/$/, "")}/admin/assistant/chat`,
        credentials: "include",
      }),
    []
  )

  const { messages, sendMessage, status, error, stop, regenerate, clearError } =
    useChat({ transport, messages: initialMessages as any })
  const streaming = status === "submitted" || status === "streaming"

  const retry = () => {
    clearError?.()
    try {
      regenerate()
    } catch {
      toast.error("Could not retry. Please send the message again.")
    }
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, status])

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

  const submit = (text: string) => {
    const t = text.trim()
    if (!t || streaming) return
    setInput("")
    sendMessage({ text: t })
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
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
          <div className="text-ui-fg-error flex items-center gap-2">
            <ExclamationCircle />
            <Text size="small">The assistant hit an error.</Text>
            <Button size="small" variant="secondary" onClick={retry}>
              <ArrowPathMini /> Retry
            </Button>
          </div>
        ) : null}
      </div>

      <div className="border-ui-border-base border-t px-6 py-4">
        <div className="flex items-end gap-2">
          <Textarea
            placeholder="Ask the admin assistant…"
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
          ) : (
            <IconButton
              variant="primary"
              disabled={!input.trim()}
              onClick={() => submit(input)}
            >
              <ArrowUpMini />
            </IconButton>
          )}
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
