import { Trash } from "@medusajs/icons"
import { Button, Container, Heading, IconButton, Input, Select, Text, Textarea } from "@medusajs/ui"
import { useMemo } from "react"
import { useFieldArray, UseFormReturn, useWatch } from "react-hook-form"

import { Form } from "../../../../components/common/form"
import { Combobox } from "../../../../components/inputs/combobox/combobox"
import { useCapabilityMatches, useTechniques } from "../../../../hooks/api/quote-briefs"
import { PartnerCombobox } from "./partner-combobox"
import { BriefFormValues, newOption, newStep } from "./schema"

type F = UseFormReturn<BriefFormValues>

/** Technique value meaning "none: name the partners directly, with a role". */
const DIRECT = "__direct__"

/**
 * Step 2: the styles. Each style is a list of steps; each step names the
 * workshops offered. A technique step searches the workshops that do it, with
 * their live rates; a step with no technique names partners directly.
 * No workshop at all = "we're exploring partners" on her page.
 */
export const BriefStylesStep = ({ form }: { form: F }) => {
  const options = useFieldArray({ control: form.control, name: "options", keyName: "_k" })

  return (
    <div className="flex flex-col items-center p-16">
      <div className="flex w-full max-w-[720px] flex-col gap-y-8">
        <div>
          <Heading>Styles</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Each style is made of steps. For each step, pick the workshops to offer her.
          </Text>
        </div>

        {options.fields.map((o, oi) => (
          <Container key={o._k} className="divide-y p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <Heading level="h2">Style {oi + 1}</Heading>
              {options.fields.length > 1 && (
                <IconButton size="small" variant="transparent" aria-label="Remove style" onClick={() => options.remove(oi)}>
                  <Trash />
                </IconButton>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name={`options.${oi}.title`}
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Name</Form.Label>
                    <Form.Control>
                      <Input {...field} placeholder="Hand-painted, non-leather" />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name={`options.${oi}.description`}
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Short description</Form.Label>
                    <Form.Control>
                      <Input {...field} />
                    </Form.Control>
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name={`options.${oi}.story`}
                render={({ field }) => (
                  <Form.Item className="md:col-span-2">
                    <Form.Label optional>Story</Form.Label>
                    <Form.Control>
                      <Textarea {...field} />
                    </Form.Control>
                    <Form.Hint>What she can tell her customers. True statements only.</Form.Hint>
                  </Form.Item>
                )}
              />
            </div>
            <StepList form={form} optionIndex={oi} />
          </Container>
        ))}

        <div>
          <Button size="small" variant="secondary" type="button" onClick={() => options.append(newOption())}>
            Add another style
          </Button>
        </div>
      </div>
    </div>
  )
}

const StepList = ({ form, optionIndex }: { form: F; optionIndex: number }) => {
  const steps = useFieldArray({ control: form.control, name: `options.${optionIndex}.steps`, keyName: "_k" })
  return (
    <>
      {steps.fields.map((s, si) => (
        <StepRow key={s._k} form={form} optionIndex={optionIndex} stepIndex={si} onRemove={steps.fields.length > 1 ? () => steps.remove(si) : null} />
      ))}
      <div className="px-6 py-4">
        <Button size="small" variant="secondary" type="button" onClick={() => steps.append(newStep())}>
          Add step
        </Button>
      </div>
    </>
  )
}

const StepRow = ({
  form,
  optionIndex: oi,
  stepIndex: si,
  onRemove,
}: {
  form: F
  optionIndex: number
  stepIndex: number
  onRemove: (() => void) | null
}) => {
  const base = `options.${oi}.steps.${si}` as const
  const techniques = useTechniques()
  const technique = useWatch({ control: form.control, name: `${base}.technique` })
  const choices = useWatch({ control: form.control, name: `${base}.choices` }) ?? []
  const direct = !technique
  const setChoices = (next: BriefFormValues["options"][number]["steps"][number]["choices"]) =>
    form.setValue(`${base}.choices`, next, { shouldDirty: true })

  return (
    <div className="flex flex-col gap-y-4 px-6 py-4">
      <div className="flex items-center justify-between">
        <Text size="small" weight="plus">
          Step {si + 1}
        </Text>
        {onRemove && (
          <IconButton size="small" variant="transparent" aria-label="Remove step" onClick={onRemove}>
            <Trash />
          </IconButton>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Form.Field
          control={form.control}
          name={`${base}.technique`}
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Technique</Form.Label>
              <Form.Control>
                <Select
                  value={field.value || DIRECT}
                  onValueChange={(v) => {
                    const t = v === DIRECT ? "" : v
                    field.onChange(t)
                    // Workshops found for one technique don't carry over to another.
                    setChoices([])
                    if (!form.getValues(`${base}.label`)) {
                      form.setValue(`${base}.label`, techniques.data?.techniques.find((x) => x.slug === t)?.label ?? "")
                    }
                  }}
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value={DIRECT}>None: name the partners</Select.Item>
                    {(techniques.data?.techniques ?? []).map((t) => (
                      <Select.Item key={t.slug} value={t.slug}>
                        {t.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </Form.Control>
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name={`${base}.label`}
          render={({ field }) => (
            <Form.Item>
              <Form.Label>{direct ? "Role" : "Label"}</Form.Label>
              <Form.Control>
                <Input {...field} placeholder={direct ? "Leather work" : "Bag stitching"} />
              </Form.Control>
              <Form.Hint>{direct ? "What these partners do. She sees it." : "What she sees for this step."}</Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Item className="md:col-span-2">
          <Form.Label optional>Workshops</Form.Label>
          {direct ? (
            <PartnerCombobox
              value={choices.map((c) => ({ id: c.partner_id, name: c.partner_name }))}
              onChange={(picked) =>
                setChoices(
                  picked.map(
                    (p) => choices.find((c) => c.partner_id === p.id) ?? { partner_id: p.id, partner_name: p.name, rate_id: null, sample_ids: [] }
                  )
                )
              }
            />
          ) : (
            <WorkshopCombobox technique={technique} value={choices} onChange={setChoices} />
          )}
          <Form.Hint>
            {direct
              ? 'Named partners start with no rate (she sees "we\'ll confirm"). Attach one on the brief page.'
              : 'Workshops that do this, with their rate. None picked shows "we\'re exploring partners".'}
          </Form.Hint>
        </Form.Item>
        <Form.Field
          control={form.control}
          name={`${base}.qty_per_piece`}
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Units per piece</Form.Label>
              <Form.Control>
                <Input type="number" {...field} placeholder="0.6" />
              </Form.Control>
              <Form.Hint>e.g. 0.6 m of fabric per bag.</Form.Hint>
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name={`${base}.lead_days`}
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Days for the order</Form.Label>
              <Form.Control>
                <Input type="number" {...field} />
              </Form.Control>
              <Form.Hint>Used when the rate has none.</Form.Hint>
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name={`${base}.note`}
          render={({ field }) => (
            <Form.Item className="md:col-span-2">
              <Form.Label optional>Note</Form.Label>
              <Form.Control>
                <Input {...field} />
              </Form.Control>
            </Form.Item>
          )}
        />
      </div>
    </div>
  )
}

type Choice = BriefFormValues["options"][number]["steps"][number]["choices"][number]

/** Workshops the capability search finds for a technique, labelled with their rate. */
const WorkshopCombobox = ({ technique, value, onChange }: { technique: string; value: Choice[]; onChange: (next: Choice[]) => void }) => {
  const matches = useCapabilityMatches(technique)
  const found = matches.data?.partners ?? []

  const options = useMemo(
    () =>
      found.map((m) => {
        const r = m.rates.find((x) => x.status === "confirmed") ?? m.rates[0]
        const rate = r
          ? `${r.currency_code.toUpperCase()} ${r.price_low}${r.price_high ? `–${r.price_high}` : ""}/${r.unit}${r.status !== "confirmed" ? " (proposed)" : ""}`
          : "we'll confirm"
        return { value: m.partner.id, label: `${m.partner.name} · ${rate}` }
      }),
    [found]
  )

  return (
    <Combobox
      value={value.map((c) => c.partner_id)}
      onChange={(ids) =>
        onChange(
          ((ids as string[]) ?? []).map((id) => {
            const kept = value.find((c) => c.partner_id === id)
            if (kept) return kept
            const m = found.find((x) => x.partner.id === id)!
            const r = m.rates.find((x) => x.status === "confirmed") ?? m.rates[0] ?? null
            return { partner_id: id, partner_name: m.partner.name, rate_id: r?.id ?? null, sample_ids: m.evidence.slice(0, 3).map((e) => e.id) }
          })
        )
      }
      options={options}
      placeholder={matches.isLoading ? "Searching workshops…" : found.length ? "Search workshops" : "Nobody on file does this yet"}
      disabled={!found.length}
    />
  )
}
