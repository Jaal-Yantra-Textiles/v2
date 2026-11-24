import { Button, Container, Heading, Input, Label, Select, Text, Textarea, toast } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { sdk } from "../../../../lib/config"
import {
  useCapabilityMatches,
  useCreateQuoteBrief,
  useTechniques,
  type CapabilityMatch,
} from "../../../../hooks/api/quote-briefs"

/**
 * Build a brief (#2608): lead partner + buyer, then styles made of steps. Each
 * step lists the partners the capability search finds for its technique, with
 * their evidence and live rates; tick the ones to offer. A step with none
 * ticked is shown to the buyer as "we're exploring partners".
 *
 * Can be started from a quote draft: ?partner_id=&country=&buyer_email=&recipient_name=
 */
type ChoiceDraft = { partner_id: string; partner_name: string; rate_id: string | null; sample_ids: string[]; note: string }
type StepDraft = { key: string; label: string; technique: string; kind: "fabric" | "process"; qty_per_piece: string; lead_days: string; note: string; choices: ChoiceDraft[] }
type OptionDraft = { key: string; title: string; description: string; story: string; steps: StepDraft[] }

const k = () => Math.random().toString(36).slice(2)
const newStep = (): StepDraft => ({ key: k(), label: "", technique: "", kind: "process", qty_per_piece: "", lead_days: "", note: "", choices: [] })
const newOption = (): OptionDraft => ({ key: k(), title: "", description: "", story: "", steps: [newStep()] })

const CreateBriefPage = () => {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const create = useCreateQuoteBrief()

  const [leadQ, setLeadQ] = useState("")
  const [lead, setLead] = useState<{ id: string; name: string } | null>(
    params.get("partner_id") ? { id: params.get("partner_id")!, name: params.get("partner_name") || params.get("partner_id")! } : null
  )
  const [head, setHead] = useState({
    title: "",
    intro: "",
    recipient_name: params.get("recipient_name") ?? "",
    recipient_company: params.get("recipient_company") ?? "",
    buyer_email: params.get("buyer_email") ?? "",
    destination_country_code: params.get("country") ?? "",
    sample_quantity: "4",
    sample_days: "14",
  })
  const [options, setOptions] = useState<OptionDraft[]>([newOption()])

  const partners = useQuery({
    queryKey: ["brief_lead_search", leadQ],
    queryFn: () => sdk.client.fetch<{ partners: any[] }>("/admin/partners", { query: { q: leadQ, limit: 8, fields: "id,name,handle" } }),
    enabled: leadQ.trim().length >= 2 && !lead,
  })

  const setOption = (key: string, patch: Partial<OptionDraft>) =>
    setOptions((os) => os.map((o) => (o.key === key ? { ...o, ...patch } : o)))
  const setStep = (ok: string, sk: string, patch: Partial<StepDraft>) =>
    setOptions((os) => os.map((o) => (o.key !== ok ? o : { ...o, steps: o.steps.map((s) => (s.key === sk ? { ...s, ...patch } : s)) })))

  const submit = () => {
    if (!lead) return toast.error("Pick the lead partner (whose store the link lives on)")
    const body = {
      partner_id: lead.id,
      title: head.title.trim(),
      intro: head.intro.trim() || null,
      destination_country_code: head.destination_country_code.trim().toLowerCase(),
      sample_quantity: head.sample_quantity ? Number(head.sample_quantity) : null,
      sample_days: head.sample_days ? Number(head.sample_days) : null,
      buyer_email: head.buyer_email.trim() || null,
      recipient_name: head.recipient_name.trim() || null,
      recipient_company: head.recipient_company.trim() || null,
      options: options.map((o) => ({
        title: o.title.trim(),
        description: o.description.trim() || null,
        story: o.story.trim() || null,
        steps: o.steps.map((s) => ({
          label: s.label.trim() || s.technique,
          kind: s.kind,
          technique: s.technique || null,
          qty_per_piece: s.qty_per_piece ? Number(s.qty_per_piece) : null,
          lead_days: s.lead_days ? Number(s.lead_days) : null,
          note: s.note.trim() || null,
          choices: s.choices.map((c) => ({ partner_id: c.partner_id, rate_id: c.rate_id, sample_ids: c.sample_ids, note: c.note.trim() || null })),
        })),
      })),
    }
    create.mutate(body, {
      onSuccess: ({ brief }) => {
        toast.success("Brief created. Open it to get the buyer's link.")
        navigate(`/quotes/briefs/${brief.id}`)
      },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <div className="flex flex-col gap-y-3 p-3">
      <Container className="flex flex-col gap-4">
        <div>
          <Heading>New brief</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Nothing is sent. You get the buyer's link when you open the brief.
          </Text>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label>Lead partner (seller, owns the link's store)</Label>
            {lead ? (
              <div className="flex items-center gap-2">
                <Text>{lead.name}</Text>
                <Button size="small" variant="transparent" onClick={() => setLead(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Input placeholder="Search partners…" value={leadQ} onChange={(e) => setLeadQ(e.target.value)} />
                <div className="flex flex-wrap gap-1">
                  {(partners.data?.partners ?? []).map((p) => (
                    <Button key={p.id} size="small" variant="secondary" onClick={() => setLead({ id: p.id, name: p.name })}>
                      {p.name}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>
          <Field label="Title" value={head.title} onChange={(v) => setHead({ ...head, title: v })} placeholder="Round crossbody bags, made by hand" />
          <Field label="Buyer name" value={head.recipient_name} onChange={(v) => setHead({ ...head, recipient_name: v })} />
          <Field label="Buyer company" value={head.recipient_company} onChange={(v) => setHead({ ...head, recipient_company: v })} />
          <Field label="Buyer email (for the CRM)" value={head.buyer_email} onChange={(v) => setHead({ ...head, buyer_email: v })} />
          <Field
            label="Buyer country (2 letters, decides the link and currency)"
            value={head.destination_country_code}
            onChange={(v) => setHead({ ...head, destination_country_code: v })}
            placeholder="au"
          />
          <Field label="Sample pieces first" value={head.sample_quantity} onChange={(v) => setHead({ ...head, sample_quantity: v })} type="number" />
          <Field label="Days to sample photos (our estimate)" value={head.sample_days} onChange={(v) => setHead({ ...head, sample_days: v })} type="number" />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Intro (shown on the welcome screen)</Label>
          <Textarea value={head.intro} onChange={(e) => setHead({ ...head, intro: e.target.value })} />
        </div>
      </Container>

      {options.map((o, oi) => (
        <Container key={o.key} className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Heading level="h2">Style {oi + 1}</Heading>
            {options.length > 1 && (
              <Button size="small" variant="transparent" onClick={() => setOptions(options.filter((x) => x.key !== o.key))}>
                Remove style
              </Button>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Style name" value={o.title} onChange={(v) => setOption(o.key, { title: v })} placeholder="Hand-painted, non-leather" />
            <Field label="Short description" value={o.description} onChange={(v) => setOption(o.key, { description: v })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>The story the buyer can tell her customers (true statements only)</Label>
            <Textarea value={o.story} onChange={(e) => setOption(o.key, { story: e.target.value })} />
          </div>
          {o.steps.map((s, si) => (
            <StepEditor
              key={s.key}
              index={si}
              step={s}
              onChange={(patch) => setStep(o.key, s.key, patch)}
              onRemove={o.steps.length > 1 ? () => setOption(o.key, { steps: o.steps.filter((x) => x.key !== s.key) }) : null}
            />
          ))}
          <div>
            <Button size="small" variant="secondary" onClick={() => setOption(o.key, { steps: [...o.steps, newStep()] })}>
              Add step
            </Button>
          </div>
        </Container>
      ))}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => setOptions([...options, newOption()])}>
          Add another style
        </Button>
        <Button onClick={submit} isLoading={create.isPending}>
          Create brief
        </Button>
      </div>
    </div>
  )
}

const StepEditor = ({
  index,
  step,
  onChange,
  onRemove,
}: {
  index: number
  step: StepDraft
  onChange: (patch: Partial<StepDraft>) => void
  onRemove: (() => void) | null
}) => {
  const techniques = useTechniques()
  const matches = useCapabilityMatches(step.technique || null)
  const offered = new Set(step.choices.map((c) => c.partner_id))

  const toggle = (m: CapabilityMatch) => {
    if (offered.has(m.partner.id)) {
      onChange({ choices: step.choices.filter((c) => c.partner_id !== m.partner.id) })
      return
    }
    const rate = m.rates.find((r) => r.status === "confirmed") ?? m.rates[0] ?? null
    onChange({
      choices: [
        ...step.choices,
        { partner_id: m.partner.id, partner_name: m.partner.name, rate_id: rate?.id ?? null, sample_ids: m.evidence.slice(0, 3).map((e) => e.id), note: "" },
      ],
    })
  }

  return (
    <div className="rounded-lg border border-ui-border-base p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Text weight="plus">Step {index + 1}</Text>
        {onRemove && (
          <Button size="small" variant="transparent" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        <div className="flex flex-col gap-1">
          <Label>Technique</Label>
          <Select value={step.technique} onValueChange={(v) => onChange({ technique: v, choices: [], label: step.label || (techniques.data?.techniques.find((t) => t.slug === v)?.label ?? "") })}>
            <Select.Trigger>
              <Select.Value placeholder="Pick…" />
            </Select.Trigger>
            <Select.Content>
              {(techniques.data?.techniques ?? []).map((t) => (
                <Select.Item key={t.slug} value={t.slug}>
                  {t.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <Field label="Label the buyer sees" value={step.label} onChange={(v) => onChange({ label: v })} placeholder="Bag stitching" />
        <Field label="Units per piece (e.g. 0.6 m)" value={step.qty_per_piece} onChange={(v) => onChange({ qty_per_piece: v })} type="number" />
        <Field label="Days for the order (if the rate has none)" value={step.lead_days} onChange={(v) => onChange({ lead_days: v })} type="number" />
        <Field label="Note" value={step.note} onChange={(v) => onChange({ note: v })} />
      </div>
      {step.technique && (
        <div className="flex flex-col gap-2">
          <Text size="small" className="text-ui-fg-subtle">
            Tick the partners to offer. None ticked = "we're exploring partners" on the buyer's page.
          </Text>
          {matches.isLoading ? (
            <Text size="small">Searching…</Text>
          ) : !(matches.data?.partners ?? []).length ? (
            <Text size="small" className="text-ui-fg-muted">Nobody on file does this yet.</Text>
          ) : (
            <div className="grid gap-2 md:grid-cols-3">
              {matches.data!.partners.map((m) => {
                const on = offered.has(m.partner.id)
                const rate = m.rates.find((r) => r.status === "confirmed") ?? m.rates[0]
                return (
                  <button
                    key={m.partner.id}
                    type="button"
                    onClick={() => toggle(m)}
                    className={`text-left rounded-md border p-3 ${on ? "border-ui-border-interactive bg-ui-bg-highlight" : "border-ui-border-base"}`}
                  >
                    <Text weight="plus">{on ? "✓ " : ""}{m.partner.name}</Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      {rate
                        ? `${rate.currency_code.toUpperCase()} ${rate.price_low}${rate.price_high ? `–${rate.price_high}` : ""} / ${rate.unit}${rate.status !== "confirmed" ? " (proposed)" : ""}`
                        : "No rate: buyer sees \"we'll confirm\""}
                    </Text>
                    <Text size="small" className="text-ui-fg-muted">
                      {m.evidence.slice(0, 2).map((e) => e.title).join(", ") || "Rate only"}
                    </Text>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const Field = ({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) => (
  <div className="flex flex-col gap-1">
    <Label>{label}</Label>
    <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  </div>
)

export const handle = { breadcrumb: () => "New brief" }

export default CreateBriefPage
