import { useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, CogSixTooth, Envelope, Folder, MagnifyingGlassMini, Sparkles } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Input, Text, toast } from "@medusajs/ui"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearchParams } from "react-router-dom"

import {
  AdminInboundEmail,
  useIgnoreInboundEmail,
  useInboundEmail,
  useInboundEmailFolders,
  useInboundEmails,
  useSyncInboundEmails,
} from "../../hooks/api/inbound-emails"
import { FoldersDrawer } from "./components/folders-drawer"

/**
 * #2377 S2 — the Inbox. Every email that reached our iCloud mailboxes (all
 * @jaalyantra.com mail lands there; mail rules sort it into folders), in one
 * place: folders on the left, the folder's emails in the middle, the open
 * email on the right with what can be done with it.
 *
 * The first action hands the email to the admin assistant, which reads it,
 * judges the shop, lines and totals, and creates the inventory items and the
 * inventory order — each write confirmed by the operator in the chat.
 */

type StatusTab = "open" | "processed" | "ignored" | "all"

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "open", label: "To do" },
  { value: "processed", label: "Done" },
  { value: "ignored", label: "Ignored" },
  { value: "all", label: "All" },
]

const STATUS_BADGE: Record<AdminInboundEmail["status"], { label: string; color: "blue" | "orange" | "green" | "grey" }> = {
  received: { label: "New", color: "blue" },
  action_pending: { label: "In progress", color: "orange" },
  processed: { label: "Done", color: "green" },
  ignored: { label: "Ignored", color: "grey" },
}

const PAGE_SIZE = 50

const formatWhen = (iso: string) => {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

/** The prompt handed to the assistant. It is placed in the chat box, not sent:
 *  the operator reads it, can add the receiving warehouse, and sends. */
const inventoryOrderPrompt = (email: AdminInboundEmail) =>
  `Turn inbound email ${email.id} ("${email.subject}", from ${email.from_address}) into an inventory order. ` +
  `Read it with get_inbound_email, then show me the supplier, their order number, each line ` +
  `(item, quantity, pack size, unit price), the currency, shipping, tax and total you read. ` +
  `Ask me which warehouse it is coming to and about anything unclear before creating anything.`

const InboxPage = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const folder = searchParams.get("folder") ?? ""
  const status = (searchParams.get("status") as StatusTab) || "open"
  const selectedId = searchParams.get("id") ?? ""
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [foldersOpen, setFoldersOpen] = useState(false)

  // Search as you stop typing, not on every key.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== "id") next.delete("id")
    setSearchParams(next, { replace: key === "id" })
  }

  const { folders = [] } = useInboundEmailFolders({ refetchInterval: 60_000 })
  const { inbound_emails = [], count = 0, isLoading } = useInboundEmails(
    {
      limit: PAGE_SIZE,
      ...(folder ? { folder } : {}),
      ...(status !== "all" ? { status } : {}),
      ...(q ? { q } : {}),
    },
    { refetchInterval: 60_000 }
  )

  const openTotal = useMemo(() => folders.reduce((n, f) => n + f.open, 0), [folders])

  const sync = useSyncInboundEmails({
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["inbound-emails"] })
      if (r.errors?.length) toast.warning(`Synced ${r.synced} new. ${r.errors.join(" · ")}`)
      else toast.success(r.synced ? `${r.synced} new email(s)` : "No new email")
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Container className="flex h-[calc(100vh-140px)] flex-col overflow-hidden p-0">
      <div className="border-ui-border-base flex items-center gap-3 border-b px-6 py-4">
        <Envelope className="text-ui-fg-subtle" />
        <div>
          <Heading level="h2">Inbox</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Company email from the iCloud folders. New mail arrives every 5 minutes.
          </Text>
        </div>
        <div className="ml-auto">
          <Button
            variant="secondary"
            size="small"
            isLoading={sync.isPending}
            onClick={() => sync.mutate({ count: 50 })}
          >
            <ArrowPath /> Check now
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Folders */}
        <nav aria-label="Folders" className="border-ui-border-base w-56 shrink-0 overflow-y-auto border-r p-2">
          <FolderButton
            label="All folders"
            open={openTotal}
            active={!folder}
            onClick={() => setParam("folder", null)}
          />
          {folders.map((f) => (
            <FolderButton
              key={f.folder}
              label={f.folder}
              open={f.open}
              active={folder === f.folder}
              onClick={() => setParam("folder", f.folder)}
            />
          ))}
          <Button
            size="small"
            variant="transparent"
            className="text-ui-fg-subtle mt-2 w-full justify-start"
            onClick={() => setFoldersOpen(true)}
          >
            <CogSixTooth /> Choose folders
          </Button>
        </nav>
        <FoldersDrawer open={foldersOpen} onOpenChange={setFoldersOpen} />

        {/* List */}
        <section aria-label="Emails" className="border-ui-border-base flex w-[380px] shrink-0 flex-col border-r">
          <div className="border-ui-border-base flex flex-col gap-2 border-b p-3">
            <div className="flex gap-1">
              {STATUS_TABS.map((t) => (
                <Button
                  key={t.value}
                  size="small"
                  variant={status === t.value ? "primary" : "transparent"}
                  onClick={() => setParam("status", t.value === "open" ? null : t.value)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
            <div className="relative">
              <MagnifyingGlassMini className="text-ui-fg-muted absolute left-2 top-1/2 -translate-y-1/2" />
              <Input
                size="small"
                className="pl-8"
                placeholder="Search subject or sender"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <Text size="small" className="text-ui-fg-subtle p-4">Loading…</Text>
            ) : inbound_emails.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle p-4">Nothing here.</Text>
            ) : (
              inbound_emails.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setParam("id", e.id)}
                  className={`border-ui-border-base block w-full border-b px-4 py-3 text-left transition-colors ${
                    selectedId === e.id ? "bg-ui-bg-base-pressed" : "hover:bg-ui-bg-base-hover"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Text
                      size="small"
                      weight={e.status === "received" ? "plus" : "regular"}
                      className="truncate"
                    >
                      {e.from_address}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-muted ml-auto shrink-0">
                      {formatWhen(e.received_at)}
                    </Text>
                  </div>
                  <Text
                    size="small"
                    weight={e.status === "received" ? "plus" : "regular"}
                    className="truncate"
                  >
                    {e.subject}
                  </Text>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge size="2xsmall" color={STATUS_BADGE[e.status].color}>
                      {STATUS_BADGE[e.status].label}
                    </Badge>
                    {!folder && (
                      <Text size="xsmall" className="text-ui-fg-muted truncate">{e.folder}</Text>
                    )}
                  </div>
                </button>
              ))
            )}
            {count > inbound_emails.length && (
              <Text size="xsmall" className="text-ui-fg-muted p-4">
                Showing the newest {inbound_emails.length} of {count}. Search to find older mail.
              </Text>
            )}
          </div>
        </section>

        {/* Reading pane */}
        <section className="flex min-w-0 flex-1 flex-col">
          {selectedId ? (
            <ReadingPane
              key={selectedId}
              id={selectedId}
              onAskAssistant={(email) =>
                navigate(`/assistant?prompt=${encodeURIComponent(inventoryOrderPrompt(email))}`)
              }
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Text size="small" className="text-ui-fg-subtle">Pick an email to read it.</Text>
            </div>
          )}
        </section>
      </div>
    </Container>
  )
}

const FolderButton = ({
  label,
  open,
  active,
  onClick,
}: {
  label: string
  open: number
  active: boolean
  onClick: () => void
}) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left ${
      active ? "bg-ui-bg-base-pressed" : "hover:bg-ui-bg-base-hover"
    }`}
  >
    <Folder className="text-ui-fg-muted shrink-0" />
    <Text size="small" className="truncate">{label}</Text>
    {open > 0 && (
      <Badge size="2xsmall" color="blue" className="ml-auto">{open}</Badge>
    )}
  </button>
)

const ReadingPane = ({
  id,
  onAskAssistant,
}: {
  id: string
  onAskAssistant: (email: AdminInboundEmail) => void
}) => {
  const queryClient = useQueryClient()
  const { inbound_email: email, isLoading } = useInboundEmail(id)
  const ignore = useIgnoreInboundEmail(id, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbound-emails"] })
      toast.success("Ignored")
    },
    onError: (e) => toast.error(e.message),
  })

  if (isLoading || !email) {
    return <Text size="small" className="text-ui-fg-subtle p-6">Loading…</Text>
  }

  const orders = email.inventory_order_ids ?? []
  const done = email.status === "processed" || orders.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-ui-border-base flex flex-col gap-3 border-b px-6 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <Heading level="h3" className="break-words">{email.subject}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {email.from_address} · {new Date(email.received_at).toLocaleString()} · {email.folder}
            </Text>
          </div>
          <Badge size="small" color={STATUS_BADGE[email.status].color} className="ml-auto shrink-0">
            {STATUS_BADGE[email.status].label}
          </Badge>
        </div>

        {orders.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Text size="small" className="text-ui-fg-subtle">Became:</Text>
            {orders.map((orderId) => (
              <Link key={orderId} to={`/orders/inventory/${orderId}`}>
                <Badge size="small" color="green">Inventory order {orderId.slice(-6)}</Badge>
              </Link>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!done && email.status !== "ignored" && (
            <Button size="small" onClick={() => onAskAssistant(email)}>
              <Sparkles /> Create inventory order with assistant
            </Button>
          )}
          {email.status !== "ignored" && !done && (
            <Button
              size="small"
              variant="secondary"
              isLoading={ignore.isPending}
              onClick={() => ignore.mutate()}
            >
              Ignore
            </Button>
          )}
          <Link to={`/settings/inbound-emails/${email.id}`}>
            <Button size="small" variant="transparent">Details</Button>
          </Link>
        </div>
      </div>

      <EmailBody email={email} />
    </div>
  )
}

/**
 * The email as its sender laid it out, in a sandboxed frame: no scripts, no
 * same-origin access to the admin, links open in a new tab. Falls back to the
 * plain text when the email has no HTML.
 */
const EmailBody = ({ email }: { email: AdminInboundEmail }) => {
  const html = email.html_body?.trim()
  if (!html) {
    return (
      <pre className="text-ui-fg-base flex-1 overflow-auto whitespace-pre-wrap p-6 font-sans text-sm">
        {email.text_body || email.body_text || "(empty)"}
      </pre>
    )
  }
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">` +
    `<style>body{margin:16px;font-family:system-ui,sans-serif;color:#111;background:#fff}img{max-width:100%;height:auto}</style>` +
    `</head><body>${html}</body></html>`
  return (
    <iframe
      title={email.subject}
      srcDoc={doc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      className="min-h-0 w-full flex-1 bg-white"
    />
  )
}

export const config = defineRouteConfig({
  label: "Inbox",
  icon: Envelope,
})

export default InboxPage
