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
import { useEffect, useMemo, useRef, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChatBubbleLeftRight, Sparkles, ArrowUpMini, Spinner, Check, ExclamationCircle } from "@medusajs/icons"
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

  const guarded = !!output && (output.requires_confirmation || output.requires_reason)
  const result = approved ?? output

  const approve = async () => {
    if (output?.requires_reason && !reason.trim()) {
      toast.error("A reason is required for this action.")
      return
    }
    setApproving(true)
    try {
      const args = (output?.plan as any)?.body || {}
      const res = await runAdminMcpTool(
        toolName,
        { ...args, ...pathArgsFrom(output?.plan) },
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
        <div className="mt-1">
          <div className="mb-2 flex items-start gap-2">
            <ExclamationCircle className="text-ui-tag-orange-icon mt-0.5" />
            <Text size="small">
              {output?.warning || "This action needs your approval before it runs."}
            </Text>
          </div>
          {output?.plan ? (
            <pre className="text-ui-fg-subtle bg-ui-bg-base mb-2 overflow-x-auto rounded p-2 text-xs">
              {JSON.stringify(output.plan, null, 2)}
            </pre>
          ) : null}
          {output?.requires_reason ? (
            <Textarea
              placeholder="Reason (why are you doing this?) — audited"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mb-2"
            />
          ) : null}
          <Button size="small" variant="danger" isLoading={approving} onClick={approve}>
            <Check /> Approve &amp; run
          </Button>
        </div>
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

/** Re-derive :param path args from a dry-run/confirmation plan's path. */
function pathArgsFrom(_plan: unknown): Record<string, unknown> {
  // Tier 1 has no guarded tools; later tiers with path params will thread the
  // original args through the tool part. Kept as a no-op seam for now.
  return {}
}

const getText = (parts: any[] | undefined): string =>
  (parts || [])
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("")

const AssistantChat = () => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState("")

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE_URL.replace(/\/$/, "")}/admin/assistant/chat`,
        credentials: "include",
      }),
    []
  )

  const { messages, sendMessage, status, error, stop } = useChat({ transport })
  const streaming = status === "submitted" || status === "streaming"

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, status])

  const submit = (text: string) => {
    const t = text.trim()
    if (!t || streaming) return
    setInput("")
    sendMessage({ text: t })
  }

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
                    <Markdown content={text} />
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
            <Text size="small">The assistant hit an error. Try again.</Text>
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
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Assistant",
  icon: ChatBubbleLeftRight,
})

export default AssistantChat
