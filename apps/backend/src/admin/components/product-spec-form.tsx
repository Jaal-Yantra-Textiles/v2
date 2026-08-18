import {
  Button,
  Checkbox,
  Heading,
  IconButton,
  Input,
  Label,
  Select,
  Switch,
  Text,
  Textarea,
} from "@medusajs/ui"
import { Plus, Trash, XMarkMini } from "@medusajs/icons"
import { useMemo } from "react"

import type {
  ProductSpecColor,
  ProductSpecField,
  ProductSpecPayload,
  WeaveTechnique,
} from "../hooks/api/product-spec"

/**
 * The product-spec editor (#1342 / #1349), ADMIN copy.
 *
 * This is a deliberate port of `apps/partner-ui/src/components/forms/
 * product-spec-form`, not an import: partner-ui and the admin extension are
 * separate builds with separate tsconfigs, and the backend's `tsconfig`
 * excludes `apps/*` outright, so there is no module either side can share.
 *
 * What keeps the two from drifting is NOT this file — it is that both generate
 * every weave, preset, parameter and range from `/…/products/spec-catalog`,
 * served by the same `weaving-techniques.ts` the upsert workflow validates
 * against. A range shown here is the range enforced on write, on both surfaces.
 * Only the chrome is duplicated; the vocabulary has one owner.
 *
 * Fully CONTROLLED, so the host decides where the value lives and when it saves.
 */

export type ProductSpecFormProps = {
  value: ProductSpecPayload
  onChange: (next: ProductSpecPayload) => void
  techniques?: WeaveTechnique[]
  families?: string[]
  isLoading?: boolean
  /** Hidden in the create wizard: a product with no orders yet cannot sensibly
   *  be "accepting custom orders" until it has been saved. */
  showCustomOrderSection?: boolean
}

const emptyColor = (order: number): ProductSpecColor => ({
  name: "",
  hex_code: "#C9A227",
  usage_notes: "",
  order,
  available: true,
})

const emptyField = (order: number): ProductSpecField => ({
  key: "",
  label: "",
  value: "",
  order,
})

export const ProductSpecForm = ({
  value,
  onChange,
  techniques = [],
  families = [],
  isLoading,
  showCustomOrderSection = true,
}: ProductSpecFormProps) => {
  const technique = useMemo(
    () => techniques.find((t) => t.slug === value.weave_technique),
    [techniques, value.weave_technique]
  )

  const grouped = useMemo(() => {
    const order = families.length
      ? families
      : Array.from(new Set(techniques.map((t) => t.family)))
    return order
      .map((family) => ({
        family,
        items: techniques.filter((t) => t.family === family),
      }))
      .filter((g) => g.items.length)
  }, [families, techniques])

  const patch = (next: Partial<ProductSpecPayload>) =>
    onChange({ ...value, ...next })

  /**
   * Changing technique clears the params. Keeping them would silently carry a
   * value the new technique does not define, which the backend then rejects on
   * save with a message about a field the partner can no longer see.
   */
  const selectTechnique = (slug: string) => {
    const next = techniques.find((t) => t.slug === slug)
    patch({
      weave_technique: slug || null,
      params: next
        ? Object.fromEntries(next.params.map((p) => [p.key, p.default]))
        : null,
      finishes: value.finishes?.length ? value.finishes : next?.defaultFinishes ?? [],
    })
  }

  const applyPreset = (presetValue: string) => {
    const preset = technique?.presets.find((p) => p.value === presetValue)
    if (!preset) return
    patch({
      weave_label: preset.detailLabel,
      params: { ...(value.params ?? {}), ...(preset.params ?? {}) },
      ...(preset.finishes ? { finishes: preset.finishes } : {}),
    })
  }

  const setParam = (key: string, raw: string) => {
    const params = { ...(value.params ?? {}) }
    if (raw.trim() === "") {
      // Blank clears the parameter rather than storing 0 — an unmeasured GSM
      // and a GSM of zero are very different claims to make to a customer.
      delete params[key]
    } else {
      params[key] = Number(raw)
    }
    patch({ params })
  }

  const colors = value.colors ?? []
  const fields = value.fields ?? []

  const setColor = (i: number, next: Partial<ProductSpecColor>) =>
    patch({ colors: colors.map((c, j) => (i === j ? { ...c, ...next } : c)) })

  const setField = (i: number, next: Partial<ProductSpecField>) =>
    patch({ fields: fields.map((f, j) => (i === j ? { ...f, ...next } : f)) })

  return (
    <div className="flex flex-col gap-y-8">
      {/* ── Weave ──────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-y-4">
        <div>
          <Heading level="h2">Weave</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            How the cloth is made. Everything here is optional — fill in what you
            know, and add anything the list is missing further down.
          </Text>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">
              Technique
            </Label>
            <Select
              value={value.weave_technique ?? ""}
              onValueChange={selectTechnique}
              disabled={isLoading || !techniques.length}
            >
              <Select.Trigger>
                <Select.Value placeholder="Choose a weave" />
              </Select.Trigger>
              <Select.Content>
                {grouped.map((group) => (
                  <Select.Group key={group.family}>
                    <Select.Label>{group.family}</Select.Label>
                    {group.items.map((t) => (
                      <Select.Item key={t.slug} value={t.slug}>
                        {t.label}
                      </Select.Item>
                    ))}
                  </Select.Group>
                ))}
              </Select.Content>
            </Select>
            {technique && (
              <Text size="xsmall" className="text-ui-fg-muted">
                {technique.description}
              </Text>
            )}
          </div>

          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">
              Your name for it
            </Label>
            <Input
              placeholder="Kani, 3-colour, Srinagar loom"
              value={value.weave_label ?? ""}
              onChange={(e) => patch({ weave_label: e.target.value })}
            />
            <Text size="xsmall" className="text-ui-fg-muted">
              Shown instead of the catalog name when set.
            </Text>
          </div>
        </div>

        {!!technique?.presets.length && (
          <div className="flex flex-wrap items-center gap-2">
            <Text size="xsmall" className="text-ui-fg-muted">
              Start from:
            </Text>
            {technique.presets.map((p) => (
              <Button
                key={p.value}
                type="button"
                size="small"
                variant="secondary"
                onClick={() => applyPreset(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        )}

        {!!technique?.params.length && (
          <div className="grid gap-4 md:grid-cols-3">
            {technique.params.map((p) => (
              <div key={p.key} className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  {p.label}
                </Label>
                <div className="flex items-center gap-x-2">
                  <Input
                    type="number"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    placeholder={String(p.default)}
                    value={value.params?.[p.key] ?? ""}
                    onChange={(e) => setParam(p.key, e.target.value)}
                  />
                  <Text size="xsmall" className="text-ui-fg-muted shrink-0">
                    {p.unit}
                  </Text>
                </div>
                <Text size="xsmall" className="text-ui-fg-muted">
                  {p.min}–{p.max}
                </Text>
              </div>
            ))}
          </div>
        )}

        {!!value.finishes?.length && (
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">
              Finishing &amp; care
            </Label>
            <div className="flex flex-wrap gap-2">
              {value.finishes.map((f, i) => (
                <span
                  key={`${f}-${i}`}
                  className="flex items-center gap-x-1 rounded-full border border-ui-border-base bg-ui-bg-subtle px-2.5 py-1"
                >
                  <Text size="xsmall">{f}</Text>
                  <IconButton
                    type="button"
                    size="2xsmall"
                    variant="transparent"
                    aria-label={`Remove ${f}`}
                    onClick={() =>
                      patch({
                        finishes: (value.finishes ?? []).filter(
                          (_, j) => j !== i
                        ),
                      })
                    }
                  >
                    <XMarkMini />
                  </IconButton>
                </span>
              ))}
            </div>
          </div>
        )}
        <FinishInput
          onAdd={(f) => patch({ finishes: [...(value.finishes ?? []), f] })}
        />
      </section>

      {/* ── Colour palette ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-y-4">
        <div>
          <Heading level="h2">Colour palette</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            The colours this can be made in. A customer ordering a custom piece
            chooses from these.
          </Text>
        </div>

        {colors.map((c, i) => (
          <div
            key={i}
            className="grid items-end gap-3 rounded-lg border border-ui-border-base p-3 md:grid-cols-[auto_1fr_1fr_auto_auto]"
          >
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Colour
              </Label>
              {/* A native colour input: the swatch IS the control, which is
                  faster than typing a hex and is what a weaver expects. */}
              <input
                type="color"
                aria-label={`Colour for ${c.name || `entry ${i + 1}`}`}
                value={c.hex_code || "#CCCCCC"}
                onChange={(e) => setColor(i, { hex_code: e.target.value })}
                className="h-8 w-12 cursor-pointer rounded border border-ui-border-base bg-ui-bg-field"
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Name
              </Label>
              <Input
                placeholder="Kashmiri walnut"
                value={c.name}
                onChange={(e) => setColor(i, { name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Used for
              </Label>
              <Input
                placeholder="Border only"
                value={c.usage_notes ?? ""}
                onChange={(e) => setColor(i, { usage_notes: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-x-2 pb-2">
              <Checkbox
                id={`color-available-${i}`}
                checked={c.available !== false}
                onCheckedChange={(v) => setColor(i, { available: !!v })}
              />
              <Label size="small" htmlFor={`color-available-${i}`}>
                Available
              </Label>
            </div>
            <IconButton
              type="button"
              size="small"
              variant="transparent"
              aria-label={`Remove ${c.name || "colour"}`}
              onClick={() => patch({ colors: colors.filter((_, j) => j !== i) })}
            >
              <Trash />
            </IconButton>
          </div>
        ))}

        <div>
          <Button
            type="button"
            size="small"
            variant="secondary"
            onClick={() => patch({ colors: [...colors, emptyColor(colors.length)] })}
          >
            <Plus />
            Add colour
          </Button>
        </div>
      </section>

      {/* ── Partner-defined fields ─────────────────────────────────────── */}
      <section className="flex flex-col gap-y-4">
        <div>
          <Heading level="h2">Anything else</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Specs the list above doesn't cover — write them in your own words.
          </Text>
        </div>

        {fields.map((f, i) => (
          <div
            key={i}
            className="grid items-end gap-3 rounded-lg border border-ui-border-base p-3 md:grid-cols-[1fr_1fr_auto]"
          >
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Spec
              </Label>
              <Input
                placeholder="Pallu type"
                value={f.label ?? ""}
                onChange={(e) =>
                  // The label is what the partner wrote; the key is derived from
                  // it (and normalised again server-side) so the same spec on two
                  // products can be compared.
                  setField(i, { label: e.target.value, key: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Value
              </Label>
              <Input
                placeholder="Woven, 18 inches"
                value={f.value ?? ""}
                onChange={(e) => setField(i, { value: e.target.value })}
              />
            </div>
            <IconButton
              type="button"
              size="small"
              variant="transparent"
              aria-label={`Remove ${f.label || "field"}`}
              onClick={() => patch({ fields: fields.filter((_, j) => j !== i) })}
            >
              <Trash />
            </IconButton>
          </div>
        ))}

        <div>
          <Button
            type="button"
            size="small"
            variant="secondary"
            onClick={() => patch({ fields: [...fields, emptyField(fields.length)] })}
          >
            <Plus />
            Add spec
          </Button>
        </div>
      </section>

      {/* ── Custom orders ──────────────────────────────────────────────── */}
      {showCustomOrderSection && (
        <section className="flex flex-col gap-y-4">
          <div>
            <Heading level="h2">Custom orders</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Whether you'll take an order made to this spec in a colour of the
              customer's choosing.
            </Text>
          </div>

          <div className="flex items-center gap-x-3">
            <Switch
              id="accepting-custom-orders"
              checked={!!value.accepting_custom_orders}
              onCheckedChange={(v) => patch({ accepting_custom_orders: v })}
            />
            <Label size="small" htmlFor="accepting-custom-orders">
              Accepting custom orders against this spec
            </Label>
          </div>

          <div className="max-w-xs flex flex-col gap-y-2">
            <Label size="small" weight="plus">
              Lead time for a custom order (days)
            </Label>
            <Input
              type="number"
              min={0}
              placeholder="30"
              value={value.custom_order_lead_time_days ?? ""}
              onChange={(e) =>
                patch({
                  custom_order_lead_time_days:
                    e.target.value.trim() === "" ? null : Number(e.target.value),
                })
              }
            />
            <Text size="xsmall" className="text-ui-fg-muted">
              A bespoke colourway usually takes longer than the ready-made piece.
            </Text>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-y-2">
        <Label size="small" weight="plus">
          Notes for the workshop
        </Label>
        <Textarea
          rows={3}
          placeholder="Warp tension eases in monsoon — allow an extra day."
          value={value.notes ?? ""}
          onChange={(e) => patch({ notes: e.target.value })}
        />
      </section>
    </div>
  )
}

/** Add-a-finish input. Kept local so Enter adds a chip without submitting the
 *  host form — inside the create wizard, Enter means "next tab". */
const FinishInput = ({ onAdd }: { onAdd: (finish: string) => void }) => {
  return (
    <div className="max-w-sm">
      <Input
        placeholder="Add a finishing or care step, then press Enter"
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          e.stopPropagation()
          const el = e.currentTarget
          const text = el.value.trim()
          if (!text) return
          onAdd(text)
          el.value = ""
        }}
      />
    </div>
  )
}
