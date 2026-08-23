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
import { AdminQuoteCreateSchemaType } from "../schema"

type Props = { form: UseFormReturn<AdminQuoteCreateSchemaType> }

type Row = any

const isProductRow = (row: Row): boolean => "variants" in (row ?? {})

const columnHelper = createDataGridHelper<Row, AdminQuoteCreateSchemaType>()

/**
 * Step 4 — how many of each variant, and at what trade price.
 *
 * Mirrors the partner wizard's grid, including the two things that are easy to
 * drop when porting:
 *
 * 🔴 The weight column is not decoration. Freight is quoted against the summed
 * basket weight, and platform-wide most variants carry no weight at either
 * level — a line with no weight cannot be quoted at all, and the operator needs
 * to see that BEFORE minting rather than discover it in a quote that came back
 * short. Which LEVEL the weight came from matters too: a declared product
 * weight over-quotes a lighter variant, and at bulk quantities that can cross a
 * carrier slab.
 *
 * 🔴 The unit-price column is in the PARTNER STORE's currency, not the quote's,
 * and the header says so. A number typed against a USD quote is otherwise read
 * as dollars; the conversion happens once at mint, at a rate the quote records.
 */
export const QuantitiesStep = ({ form }: Props) => {
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
        header: "Unit weight",
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

          return (
            <DataGridReadonlyCell context={context} color="normal">
              {resolved == null ? (
                <span className="text-ui-fg-error truncate">
                  No weight — cannot quote
                </span>
              ) : (
                <span className="truncate">
                  {resolved} g
                  {source === "product" ? (
                    <span className="text-ui-fg-subtle"> (product)</span>
                  ) : null}
                </span>
              )}
            </DataGridReadonlyCell>
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
    </div>
  )
}
