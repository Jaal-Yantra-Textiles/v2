import { Badge, Button, Container, Heading, Input, Label, Select, StatusBadge, Text, Textarea, toast } from "@medusajs/ui"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"

import {
  useOpenQuoteBrief,
  usePostBriefUpdate,
  useQuoteBrief,
  useUpdateQuoteBrief,
} from "../../../../hooks/api/quote-briefs"
import { BRIEF_STATUS } from "../page"

/**
 * One brief (#2608): the buyer's link, her picks and answers, the CRM record
 * it became, and updates we post back to her page (sample photos).
 */
const BriefPage = () => {
  const { id } = useParams()
  const { data, isLoading } = useQuoteBrief(id!)
  const open = useOpenQuoteBrief(id!)
  const update = useUpdateQuoteBrief(id!)
  const post = usePostBriefUpdate(id!)
  const [link, setLink] = useState<string | null>(null)
  const [emailBuyer, setEmailBuyer] = useState(false)
  const [msg, setMsg] = useState({ kind: "note", message: "", media: "" })

  if (isLoading || !data?.brief) return <Container>Loading…</Container>
  const b = data.brief
  const st = BRIEF_STATUS[b.status]

  return (
    <div className="flex flex-col gap-y-3 p-3">
      <Container className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Heading>{b.title}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {b.recipient_name || "No buyer name"}
              {b.recipient_company ? `, ${b.recipient_company}` : ""} · {b.buyer_email || "no email"} ·{" "}
              {String(b.destination_country_code).toUpperCase()} · {b.view_count ?? 0} views
              {b.submitted_at ? ` · sent ${new Date(b.submitted_at).toLocaleString()}` : " · not sent yet"}
            </Text>
          </div>
          <StatusBadge color={st?.color ?? "grey"}>{st?.label ?? b.status}</StatusBadge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="small"
            isLoading={open.isPending}
            onClick={() =>
              open.mutate(
                { email_buyer: emailBuyer },
                {
                  onSuccess: (r) => {
                    setLink(r.url)
                    if (emailBuyer) {
                      r.email.sent ? toast.success(`Emailed to ${r.email.to}`) : toast.error(`Link made, but not emailed: ${r.email.reason}`)
                    }
                  },
                  onError: (e) => toast.error(e.message),
                }
              )
            }
          >
            {b.has_link ? "Issue a new link" : "Open and get the buyer's link"}
          </Button>
          <label className="flex items-center gap-1.5 text-ui-fg-subtle text-sm">
            <input type="checkbox" checked={emailBuyer} disabled={!b.buyer_email} onChange={(e) => setEmailBuyer(e.target.checked)} />
            {b.buyer_email ? `Email the link to ${b.buyer_email}` : "No buyer email to send to"}
          </label>
          <Select
            value={b.status}
            onValueChange={(v) => update.mutate({ status: v }, { onError: (e) => toast.error(e.message) })}
          >
            <Select.Trigger className="w-48">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {Object.entries(BRIEF_STATUS).map(([k, v]) => (
                <Select.Item key={k} value={k}>
                  {v.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          {b.crm_opportunity_id && <Badge color="green">In CRM: {b.crm_opportunity_id}</Badge>}
          {b.has_link && !link && (
            <Text size="small" className="text-ui-fg-muted">
              The link was shown once when issued. Issuing a new one stops the old one working.
            </Text>
          )}
        </div>
        {link && (
          <div className="rounded-md border border-ui-border-interactive p-3">
            <Text size="small" weight="plus">
              Buyer's link (shown once, copy it now):
            </Text>
            <Text size="small" className="break-all font-mono">
              {link}
            </Text>
          </div>
        )}
      </Container>

      <Container className="flex flex-col gap-4">
        <Heading level="h2">What the buyer picked</Heading>
        {b.options.map((o: any) => (
          <div key={o.id} className={`rounded-md border p-3 ${o.buyer_selected ? "border-ui-border-interactive" : "border-ui-border-base opacity-70"}`}>
            <Text weight="plus">
              {o.buyer_selected ? "✓ " : ""}
              {o.title}
            </Text>
            <ul className="mt-1">
              {o.steps.map((s: any) => {
                const pick = s.choices.find((c: any) => c.id === s.selected_choice_id)
                return (
                  <li key={s.id}>
                    <Text size="small">
                      {s.label}:{" "}
                      {s.state === "exploring"
                        ? "no partner yet (sourcing)"
                        : pick
                          ? `${pick.partner.name} (her pick)`
                          : s.choices.map((c: any) => c.partner.name).join(" / ")}
                      {s.state === "ask" ? " · needs a rate" : ""}
                    </Text>
                  </li>
                )
              })}
            </ul>
            {o.estimate?.per_piece_high > 0 && (
              <Text size="small" className="text-ui-fg-subtle mt-1">
                Estimate {String(o.estimate.currency_code).toUpperCase()} {o.estimate.per_piece_low}–{o.estimate.per_piece_high} / piece
                {o.estimate.complete ? "" : ` so far (to confirm: ${o.estimate.pending_steps.join(", ")})`}
              </Text>
            )}
          </div>
        ))}
      </Container>

      <Container className="flex flex-col gap-2">
        <Heading level="h2">Her answers</Heading>
        {b.questions.map((q: any) => (
          <div key={q.id} className="grid grid-cols-[14rem_1fr] gap-2">
            <Text size="small" className="text-ui-fg-subtle">
              {q.label}
            </Text>
            <Text size="small">
              {q.answer == null
                ? "—"
                : q.kind === "file"
                  ? (q.answer as any[]).map((f) => (
                      <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="text-ui-fg-interactive mr-2 underline">
                        {f.name}
                      </a>
                    ))
                  : Array.isArray(q.answer)
                    ? q.answer.join(", ")
                    : String(q.answer)}
            </Text>
          </div>
        ))}
      </Container>

      <Container className="flex flex-col gap-3">
        <Heading level="h2">Post an update to her page</Heading>
        <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
          <div className="flex flex-col gap-1">
            <Label>Kind</Label>
            <Select value={msg.kind} onValueChange={(v) => setMsg({ ...msg, kind: v })}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="note">Note</Select.Item>
                <Select.Item value="sample">Samples</Select.Item>
                <Select.Item value="price">Price</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Message</Label>
            <Textarea value={msg.message} onChange={(e) => setMsg({ ...msg, message: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Photo URLs (one per line)</Label>
          <Input value={msg.media} onChange={(e) => setMsg({ ...msg, media: e.target.value })} placeholder="https://…" />
        </div>
        <div>
          <Button
            size="small"
            isLoading={post.isPending}
            disabled={!msg.message.trim()}
            onClick={() =>
              post.mutate(
                {
                  kind: msg.kind,
                  message: msg.message.trim(),
                  media_urls: msg.media.split(/\s+/).map((x) => x.trim()).filter(Boolean),
                },
                {
                  onSuccess: () => {
                    toast.success("Posted. She'll see it on her page.")
                    setMsg({ kind: "note", message: "", media: "" })
                  },
                  onError: (e) => toast.error(e.message),
                }
              )
            }
          >
            Post update
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {b.updates.map((u: any) => (
            <li key={u.id} className="border-l-2 border-ui-border-strong pl-3">
              <Text size="small" className="text-ui-fg-muted">
                {new Date(u.created_at).toLocaleString()} · {u.kind}
              </Text>
              <Text size="small">{u.message}</Text>
            </li>
          ))}
        </ul>
        <Text size="small" className="text-ui-fg-muted">
          <Link to="/quotes/briefs" className="underline">
            All briefs
          </Link>
        </Text>
      </Container>
    </div>
  )
}

export const handle = { breadcrumb: () => "Brief" }

export default BriefPage
