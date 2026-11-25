import { Button, Drawer, Input, Label, Select, Switch, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"

import {
  AdminBrief,
  useOpenQuoteBrief,
  usePartnerRates,
  usePostBriefUpdate,
  useUpdateBriefChoice,
  useUpdateQuoteBrief,
} from "../../../../hooks/api/quote-briefs"
import { BRIEF_STATUS } from "../page"

/**
 * The brief page's editing drawers (#2608). The page itself is a read-only
 * record, like the quote draft page; every change is reached through the `…`
 * menu of the card that owns it and made here.
 */

const NO_RATE = "__none__"

/** The choice whose rate is being set, with the step it sits on. */
export type ChoiceTarget = {
  choice: any
  stepLabel: string
  technique: string | null
}

export const ChoiceRateDrawer = ({
  briefId,
  target,
  onClose,
}: {
  briefId: string
  target: ChoiceTarget | null
  onClose: () => void
}) => {
  const choice = target?.choice
  // Modal-only data: loads when the drawer is open.
  const { data, isLoading } = usePartnerRates(choice?.partner.id ?? null, !!target)
  const save = useUpdateBriefChoice(briefId)
  const [rateId, setRateId] = useState<string>(NO_RATE)
  const [note, setNote] = useState("")

  useEffect(() => {
    if (!choice) return
    setRateId(choice.rate_id ?? NO_RATE)
    setNote(choice.note ?? "")
  }, [choice?.id])

  // A step's technique narrows the list; a fabric step has none, so show all.
  const rates = (data?.rates ?? []).filter(
    (r) => !target?.technique || r.technique === target.technique || r.id === choice?.rate_id
  )
  const fmt = (r: any) =>
    `${r.technique} · ${String(r.currency_code).toUpperCase()} ${r.price_low}${
      r.price_high != null ? `–${r.price_high}` : ""
    } / ${r.unit}${r.status === "confirmed" ? "" : ` (${r.status})`}`

  const submit = () =>
    save.mutate(
      { choiceId: choice.id, rate_id: rateId === NO_RATE ? null : rateId, note: note.trim() || null },
      {
        onSuccess: () => {
          toast.success(rateId === NO_RATE ? `${choice.partner.name}: back to "we'll confirm"` : `Rate attached for ${choice.partner.name}`)
          onClose()
        },
        onError: (e) => toast.error(e.message),
      }
    )

  return (
    <Drawer open={!!target} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {choice?.partner.name} · {target?.stepLabel}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <Text size="small" className="text-ui-fg-subtle">
            The buyer's estimate uses this rate from her next visit. Nothing is sent to her.
          </Text>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">
              Rate
            </Label>
            <Select size="small" value={rateId} onValueChange={setRateId} disabled={isLoading}>
              <Select.Trigger>
                <Select.Value placeholder={isLoading ? "Loading rates…" : undefined} />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value={NO_RATE}>No rate (we'll confirm)</Select.Item>
                {rates.map((r) => (
                  <Select.Item key={r.id} value={r.id}>
                    {fmt(r)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            {!isLoading && !rates.length && (
              <Text size="small" className="text-ui-fg-muted">
                No {target?.technique ?? ""} rate is recorded for this workshop. Add one on the partner's
                capabilities first.
              </Text>
            )}
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">
              Note (shown to the buyer)
            </Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary" size="small">
              Cancel
            </Button>
          </Drawer.Close>
          <Button size="small" isLoading={save.isPending} disabled={isLoading} onClick={submit}>
            Save
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/**
 * 🔴 Issuing a link mints a NEW token and kills the old one — the buyer's
 * current link stops working. Said in the drawer, not only in a tooltip.
 */
export const IssueLinkDrawer = ({
  brief,
  open,
  onClose,
  onIssued,
}: {
  brief: AdminBrief
  open: boolean
  onClose: () => void
  onIssued: (url: string) => void
}) => {
  const issue = useOpenQuoteBrief(brief.id)
  const [emailBuyer, setEmailBuyer] = useState(false)

  const submit = () =>
    issue.mutate(
      { email_buyer: emailBuyer },
      {
        onSuccess: (r) => {
          onIssued(r.url)
          if (emailBuyer) {
            r.email.sent ? toast.success(`Emailed to ${r.email.to}`) : toast.error(`Link made, but not emailed: ${r.email.reason}`)
          } else {
            toast.success("Link issued")
          }
          onClose()
        },
        onError: (e) => toast.error(e.message),
      }
    )

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{brief.has_link ? "Issue a new link" : "Open the brief"}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4">
          {brief.has_link ? (
            <Text size="small" className="text-ui-fg-error">
              The buyer's current link stops working the moment a new one is issued.
            </Text>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              Creates the buyer's link. It is shown once, so copy it when it appears.
            </Text>
          )}
          <div className="flex items-start gap-x-3">
            <Switch id="email-buyer" checked={emailBuyer} disabled={!brief.buyer_email} onCheckedChange={setEmailBuyer} />
            <div className="flex flex-col">
              <Label htmlFor="email-buyer" size="small" weight="plus">
                Email the link
              </Label>
              <Text size="small" className="text-ui-fg-subtle">
                {brief.buyer_email ? `Sends it to ${brief.buyer_email}` : "This brief has no buyer email"}
              </Text>
            </div>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary" size="small">
              Cancel
            </Button>
          </Drawer.Close>
          <Button size="small" isLoading={issue.isPending} onClick={submit}>
            {brief.has_link ? "Issue new link" : "Open brief"}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

export const StatusDrawer = ({ brief, open, onClose }: { brief: AdminBrief; open: boolean; onClose: () => void }) => {
  const update = useUpdateQuoteBrief(brief.id)
  const [status, setStatus] = useState<string>(brief.status)
  useEffect(() => {
    if (open) setStatus(brief.status)
  }, [open, brief.status])

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Change status</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">
            Status
          </Label>
          <Select size="small" value={status} onValueChange={setStatus}>
            <Select.Trigger>
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
          <Text size="small" className="text-ui-fg-subtle">
            At Sampling her answers lock. At Quoted or Closed the partner rates stop changing.
          </Text>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary" size="small">
              Cancel
            </Button>
          </Drawer.Close>
          <Button
            size="small"
            isLoading={update.isPending}
            disabled={status === brief.status}
            onClick={() =>
              update.mutate(
                { status },
                {
                  onSuccess: () => {
                    toast.success("Status updated")
                    onClose()
                  },
                  onError: (e) => toast.error(e.message),
                }
              )
            }
          >
            Save
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

export const PostUpdateDrawer = ({ briefId, open, onClose }: { briefId: string; open: boolean; onClose: () => void }) => {
  const post = usePostBriefUpdate(briefId)
  const [msg, setMsg] = useState({ kind: "note", message: "", media: "" })

  const submit = () =>
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
          onClose()
        },
        onError: (e) => toast.error(e.message),
      }
    )

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Post an update</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <Text size="small" className="text-ui-fg-subtle">
            Shows on the buyer's page. It does not email her.
          </Text>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">
              Kind
            </Label>
            <Select size="small" value={msg.kind} onValueChange={(v) => setMsg({ ...msg, kind: v })}>
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
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">
              Message
            </Label>
            <Textarea value={msg.message} onChange={(e) => setMsg({ ...msg, message: e.target.value })} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">
              Photo URLs (space or line separated)
            </Label>
            <Input size="small" value={msg.media} onChange={(e) => setMsg({ ...msg, media: e.target.value })} placeholder="https://…" />
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary" size="small">
              Cancel
            </Button>
          </Drawer.Close>
          <Button size="small" isLoading={post.isPending} disabled={!msg.message.trim()} onClick={submit}>
            Post update
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
