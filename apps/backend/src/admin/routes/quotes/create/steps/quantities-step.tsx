import { Button, Input, Label, Text } from "@medusajs/ui"
import { ColumnDef } from "@tanstack/react-table"
import { useMemo, useState } from "react"
import { UseFormReturn, useWatch } from "react-hook-form"

import { Thumbnail } from "../../../../components/common/thumbnail"
import { DataGrid } from "../../../../components/data-grid/data-grid"
import { DataGridNumberCell } from "../../../../components/data-grid/components/data-grid-number-cell"
import { DataGridReadonlyCell } from "../../../../components/data-grid/components/data-grid-readonly-cell"
import { createDataGridHelper } from "../../../../components/data-grid/helpers/create-data-grid-column-helper"
import { useProducts } from "../../../../hooks/api/products"
import { AdminLineDesignsPanel } from "../line-designs-panel"
import { AdminQuoteCreateSchemaType } from "../schema"

type Props = {
  form: UseFormReturn<AdminQuoteCreateSchemaType>
  /**
   * Render the per-line design picker inline, below the grid.
   *
   * Default `true` keeps every existing caller unchanged. The draft's items
   * modal passes `false` and lifts the panel into a `StackedFocusModal` on top
   * of itself instead: inline, the panel competes with a full-width DataGrid
   * for the same vertical space, and the operator has to scroll past every line
   * to reach it. Stacked, it opens over the grid it annotates.
   */
  showDesignPanel?: boolean
}

type Row = any

const isProductRow = (row: Row): boolean => "variants" in (row ?? {})

const columnHelper = createDataGridHelper<Row, AdminQuoteCreateSchemaType>()

/**
 * Step 4 — how many of each variant, and at what trade price.
 *
 * Mirrors the partner wizard's grid, including the two things that are easy to
 * drop when porting:
 *
 * 🔴 The weight column is not decoration, and it is EDITABLE.
 *
 * Freight is quoted against the summed basket weight, and `buildShippingEstimate`
 * refuses the whole basket on the first line it cannot weigh — 183 variants
 * platform-wide carry no weight at either level, and a design quoted before its
 * garment has ever been weighed has none by definition. Read-only, that made a
 * design-led quote unpriceable with no way out of the wizard.
 *
 * So the operator types the weight they measured. It prices THIS quote and is
 * never written back to the variant: a figure typed under time pressure must
 * not become the catalogue's answer for every future basket.
 *
 * Which LEVEL the weight came from still matters and is still shown — a declared
 * product weight over-quotes a lighter variant, and at bulk quantities that can
 * cross a carrier slab. The catalogue figure is the PLACEHOLDER, so a typed
 * number and an inherited one stay distinguishable.
 *
 * 🔴 The unit-price column is in the PARTNER STORE's currency, not the quote's,
 * and the header says so. A number typed against a USD quote is otherwise read
 * as dollars; the conversion happens once at mint, at a rate the quote records.
 */
export const QuantitiesStep = ({ form, showDesignPanel = true }: Props) => {
  const ids = useWatch({ control: form.control, name: "product_ids" })
  const { products } = useProducts({ limit: 100 } as any)

  const selected = useMemo(() => {
    const wanted = new Set((ids ?? []).map((p) => p.id))
    return ((products ?? []) as Row[]).filter(
      (p) => isProductRow(p) && wanted.has(p.id)
    )
  }, [products, ids])

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      columnHelper.column({
        id: "title",
        header: "Product",
        cell: (context: any) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return (
              <DataGridReadonlyCell context={context}>
                <div className="flex h-full w-full items-center gap-x-2 overflow-hidden">
                  <Thumbnail src={entity.thumbnail} size="small" />
                  <span className="truncate">{entity.title}</span>
                </div>
              </DataGridReadonlyCell>
            )
          }
          return (
            <DataGridReadonlyCell context={context} color="normal">
              <span className="truncate">{entity.title}</span>
            </DataGridReadonlyCell>
          )
        },
        disableHiding: true,
      }),
      columnHelper.column({
        id: "weight",
        name: "Unit weight (g)",
        header: "Unit weight (g)",
        field: (context: any) => {
          const entity = context.row.original
          if (isProductRow(entity)) return null
          return `weights.${entity.id}` as const
        },
        type: "number",
        cell: (context: any) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return <DataGridReadonlyCell context={context} />
          }

          const variantWeight = entity.weight
          // The listing nests variants under their product, so the fallback
          // lives on the parent row — variants carry no back-reference here.
          const productWeight = context.row.getParentRow()?.original?.weight
          const resolved = variantWeight ?? productWeight ?? null
          const source = variantWeight != null ? "variant" : "product"

          /**
           * 🔴 Editable, and blank does NOT mean zero.
           *
           * The catalogue figure is shown as the placeholder rather than
           * prefilled: prefilling would send a catalogue weight as though an
           * operator had vouched for it, and `quoted_weight_source` on the
           * frozen line would then read `manual` for a number nobody typed.
           * Leaving it blank keeps "the catalogue answered" and "a human
           * answered" distinguishable on the document.
           *
           * A line with no catalogue weight says so in the placeholder. It used
           * to read "No weight — cannot quote", which was true: the estimate
           * refuses the WHOLE basket on the first line it cannot weigh, so a
           * design quoted before its garment was ever weighed could not be
           * priced at all. Now it can be, by typing the weight.
           */
          return (
            <DataGridNumberCell
              context={context}
              min={1}
              placeholder={
                resolved == null
                  ? "Enter to quote"
                  : `${resolved}${source === "product" ? " (product)" : ""}`
              }
            />
          )
        },
      }),
      columnHelper.column({
        id: "discount_percent",
        name: "Discount %",
        header: "Discount %",
        field: (context: any) => {
          const entity = context.row.original
          if (isProductRow(entity)) return null
          return `discounts.${entity.id}` as const
        },
        type: "number",
        cell: (context: any) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return <DataGridReadonlyCell context={context} />
          }
          return <DataGridNumberCell context={context} min={0} max={100} />
        },
      }),
      columnHelper.column({
        id: "override_unit_amount",
        name: "Unit price",
        header: "Unit price (store currency)",
        field: (context: any) => {
          const entity = context.row.original
          if (isProductRow(entity)) return null
          return `overrides.${entity.id}` as const
        },
        type: "number",
        cell: (context: any) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return <DataGridReadonlyCell context={context} />
          }
          return <DataGridNumberCell context={context} min={0} />
        },
      }),
      columnHelper.column({
        id: "quantity",
        name: "Quantity",
        header: "Quantity",
        field: (context: any) => {
          const entity = context.row.original
          if (isProductRow(entity)) return null
          return `quantities.${entity.id}` as const
        },
        type: "number",
        cell: (context: any) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return <DataGridReadonlyCell context={context} />
          }
          return <DataGridNumberCell context={context} min={0} />
        },
      }),
    ],
    []
  )

  /**
   * One percentage across the whole basket (#1446).
   *
   * 🔑 It writes into the per-line fields rather than becoming a quote-level
   * discount of its own. The backend stores the override PER LINE with the
   * rate and input it was reached by, because that is what makes a quoted
   * number reproducible later — a basket-level percentage would have to be
   * re-derived against catalogue prices that have since moved. So this is a
   * typing shortcut with no server-side counterpart, which is exactly what it
   * should be.
   *
   * It fills every variant of every selected product, including ones with no
   * quantity yet: a line added afterwards would otherwise silently miss the
   * discount the operator believes they applied to "everything".
   */
  const [bulkDiscount, setBulkDiscount] = useState<string>("")

  const applyToAll = () => {
    const percent = Number(bulkDiscount)
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return

    const next: Record<string, number> = {}
    for (const product of selected) {
      for (const variant of (product.variants ?? []) as Row[]) {
        next[variant.id] = percent
      }
    }

    form.setValue("discounts", next, { shouldDirty: true })
    // A flat unit price and a percentage are mutually exclusive per line, and
    // the backend refuses both together. Applying a blanket percentage clears
    // the prices it would otherwise collide with, rather than minting a basket
    // that 400s on submit.
    form.setValue("overrides", {}, { shouldDirty: true })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2 px-6 pb-4 md:px-16">
        <div className="flex flex-col gap-y-1">
          <Label size="small">Discount % on every line</Label>
          <Input
            type="number"
            min={0}
            max={100}
            className="w-32"
            placeholder="e.g. 15"
            value={bulkDiscount}
            onChange={(e) => setBulkDiscount(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={applyToAll}
          disabled={!bulkDiscount}
        >
          Apply to all
        </Button>
        <Text size="small" className="text-ui-fg-subtle">
          A shortcut for the column — every line is still quoted, stored and
          audited individually, and any line can be overridden afterwards.
        </Text>
      </div>

      <DataGrid
        columns={columns}
        data={selected}
        getSubRows={(row: Row) =>
          isProductRow(row) ? row.variants ?? [] : undefined
        }
        state={form}
      />

      {/*
        Below the grid, not inside it (#1501): a design is picked from hundreds
        by NAME, which is a search, and the grid is a numeric keyboard surface
        whose arrow-key navigation a combobox would fight. The draft's items
        modal turns this off and stacks the same panel over the grid instead.
      */}
      {showDesignPanel && <AdminLineDesignsPanel form={form} products={selected} />}
    </div>
  )
}
