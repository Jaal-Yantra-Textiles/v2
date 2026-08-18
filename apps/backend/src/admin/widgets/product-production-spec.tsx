import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { PencilSquare } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  FocusModal,
  Heading,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

import { ProductSpecForm } from "../components/product-spec-form"
import {
  useProductSpec,
  useUpsertProductSpec,
  useWeaveCatalog,
  type ProductSpecColor,
  type ProductSpecField,
  type ProductSpecPayload,
  type WeaveTechnique,
} from "../hooks/api/product-spec"

/**
 * #1349 — the production spec on the ADMIN product page.
 *
 * Same shape as the partner surface: the widget READS, and a modal writes.
 * Admins were the one audience with no way to see a spec at all — the data was
 * reachable only through the partner portal or an MCP call, so a support
 * question about what a piece is made to could not be answered from the admin.
 *
 * A `FocusModal` rather than the `Drawer` the admin guidance prefers for edits:
 * the editor is a five-part form with a parameter grid and a repeatable colour
 * palette, and a drawer's width forces every row to wrap. The rule exists so
 * edits stay in place and lightweight; this edit is neither.
 */

type AdminProduct = { id: string; title?: string }

const EMPTY: ProductSpecPayload = {
  weave_technique: null,
  weave_label: null,
  params: null,
  finishes: [],
  notes: null,
  accepting_custom_orders: false,
  custom_order_lead_time_days: null,
  colors: [],
  fields: [],
}

/** A stored param rendered with the label + unit its technique defines. Falls
 *  back to the raw key so a param whose technique was renamed still shows. */
const paramRows = (
  params: Record<string, number> | null | undefined,
  technique?: WeaveTechnique
) =>
  Object.entries(params ?? {}).map(([key, value]) => {
    const def = technique?.params.find((p) => p.key === key)
    return {
      key,
      label: def?.label ?? key,
      value: def?.unit ? `${value} ${def.unit}` : `${value}`,
    }
  })

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="text-ui-fg-subtle grid w-full grid-cols-1 items-start gap-1 px-6 py-4 sm:grid-cols-2 sm:items-center sm:gap-4">
    <Text size="small" weight="plus" leading="compact">
      {label}
    </Text>
    <div className="flex flex-wrap items-center gap-1">{children}</div>
  </div>
)

const ProductProductionSpecWidget = ({
  data: product,
}: DetailWidgetProps<AdminProduct>) => {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<ProductSpecPayload>(EMPTY)
  const [dirty, setDirty] = useState(false)

  // Display query — no `enabled` gate on modal state, or the widget renders
  // empty every time the page is refreshed with the modal closed.
  const { spec, isLoading } = useProductSpec(product.id)
  const { techniques, families, isLoading: catalogLoading } = useWeaveCatalog()
  const { mutateAsync, isPending } = useUpsertProductSpec(product.id)

  useEffect(() => {
    if (!spec || dirty) {
      return
    }
    setValue({
      weave_technique: spec.weave_technique ?? null,
      weave_label: spec.weave_label ?? null,
      params: spec.params ?? null,
      finishes: spec.finishes ?? [],
      notes: spec.notes ?? null,
      accepting_custom_orders: !!spec.accepting_custom_orders,
      custom_order_lead_time_days: spec.custom_order_lead_time_days ?? null,
      colors: (spec.colors ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      fields: (spec.fields ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    })
  }, [spec, dirty])

  const technique = techniques.find((t) => t.slug === spec?.weave_technique)
  const colors: ProductSpecColor[] = (spec?.colors ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const fields: ProductSpecField[] = (spec?.fields ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const params = paramRows(spec?.params, technique)
  const finishes = spec?.finishes ?? []

  // A spec row can exist carrying nothing but defaults, so "has a spec" is
  // decided by whether anything was written — not by the row existing.
  const hasContent =
    !!spec?.weave_technique ||
    !!spec?.weave_label ||
    !!spec?.notes ||
    !!params.length ||
    !!finishes.length ||
    !!colors.length ||
    !!fields.length

  const handleSave = async () => {
    // Drop half-written rows rather than sending them: the route rejects a
    // colour with no name, and losing the whole save over a row the admin
    // forgot about is worse than silently ignoring it.
    const payload: ProductSpecPayload = {
      ...value,
      weave_label: value.weave_label?.trim() ? value.weave_label.trim() : null,
      notes: value.notes?.trim() ? value.notes.trim() : null,
      colors: (value.colors ?? []).filter((c) => c.name.trim()),
      fields: (value.fields ?? []).filter((f) => (f.label ?? f.key).trim()),
    }

    try {
      await mutateAsync(payload)
      setDirty(false)
      setOpen(false)
      toast.success("Production spec saved")
    } catch (e: any) {
      toast.error(e?.message || "Could not save the production spec")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Production spec</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            The weave, colours and specs this product is made to.
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          {spec?.accepting_custom_orders && (
            <Badge size="2xsmall" color="green">
              {spec.custom_order_lead_time_days
                ? `Custom orders · ${spec.custom_order_lead_time_days} days`
                : "Custom orders"}
            </Badge>
          )}
          <Button
            size="small"
            variant="secondary"
            onClick={() => setOpen(true)}
            disabled={isLoading || catalogLoading}
          >
            <PencilSquare />
            {hasContent ? "Edit" : "Add spec"}
          </Button>
        </div>
      </div>

      {isLoading || catalogLoading ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Loading spec…
          </Text>
        </div>
      ) : !hasContent ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            No production spec has been written for this product.
          </Text>
        </div>
      ) : (
        <>
          <Row label="Weave">
            <Text size="small" leading="compact">
              {technique?.label ?? spec?.weave_technique ?? "-"}
            </Text>
          </Row>
          {spec?.weave_label && (
            <Row label="Weave name">
              <Text size="small" leading="compact">
                {spec.weave_label}
              </Text>
            </Row>
          )}
          {params.map((param) => (
            <Row key={param.key} label={param.label}>
              <Text size="small" leading="compact">
                {param.value}
              </Text>
            </Row>
          ))}
          {!!finishes.length && (
            <Row label="Finishes">
              {finishes.map((finish) => (
                <Badge key={finish} size="2xsmall">
                  {finish}
                </Badge>
              ))}
            </Row>
          )}
          {!!colors.length && (
            <Row label="Palette">
              {colors.map((color) => (
                <div
                  key={color.id ?? color.name}
                  className="border-ui-border-base bg-ui-bg-subtle flex items-center gap-x-2 rounded-full border py-1 pl-1 pr-3"
                >
                  <span
                    className="border-ui-border-base size-5 rounded-full border"
                    style={{ backgroundColor: color.hex_code ?? "transparent" }}
                    aria-hidden
                  />
                  <Text size="small" leading="compact">
                    {color.name}
                  </Text>
                  {color.available === false && (
                    <Badge size="2xsmall" color="grey">
                      Unavailable
                    </Badge>
                  )}
                </div>
              ))}
            </Row>
          )}
          {spec?.notes && (
            <Row label="Notes">
              <Text
                size="small"
                leading="compact"
                className="whitespace-pre-line"
              >
                {spec.notes}
              </Text>
            </Row>
          )}
          {fields.map((field) => (
            <Row
              key={field.id ?? field.key}
              label={field.label?.trim() || field.key}
            >
              <Text size="small" leading="compact">
                {field.value ?? "-"}
              </Text>
            </Row>
          ))}
        </>
      )}

      <FocusModal open={open} onOpenChange={setOpen}>
        <FocusModal.Content>
          <FocusModal.Header>
            <div className="flex items-center justify-end gap-x-2">
              <Button
                size="small"
                onClick={handleSave}
                isLoading={isPending}
                disabled={isPending}
              >
                Save
              </Button>
            </div>
          </FocusModal.Header>
          <FocusModal.Body className="flex flex-1 flex-col overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-6 px-6 py-16">
              <div className="flex flex-col gap-y-1">
                <Heading level="h2">Production spec</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  {product.title
                    ? `What ${product.title} is made to.`
                    : "What this product is made to."}
                </Text>
              </div>
              <ProductSpecForm
                value={value}
                onChange={(next) => {
                  setDirty(true)
                  setValue(next)
                }}
                techniques={techniques}
                families={families}
                isLoading={isLoading || catalogLoading}
              />
            </div>
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductProductionSpecWidget
