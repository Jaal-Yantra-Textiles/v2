import { HttpTypes } from "@medusajs/types"
import { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { UseFormReturn, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { Thumbnail } from "../../../../../components/common/thumbnail"
import {
  DataGrid,
  createDataGridHelper,
} from "../../../../../components/data-grid"
import { useProducts } from "../../../../../hooks/api/products"
import { QuoteCreateSchemaType } from "./schema"
import { QuoteLineDesignsPanel } from "./quote-line-designs-panel"

type QuoteQuantitiesFormProps = {
  form: UseFormReturn<QuoteCreateSchemaType>
}

type Row = HttpTypes.AdminProduct | HttpTypes.AdminProductVariant

const isProductRow = (row: Row): row is HttpTypes.AdminProduct =>
  "variants" in row

const columnHelper = createDataGridHelper<Row, QuoteCreateSchemaType>()

/**
 * Step 3 — how many of each variant, and at what trade price.
 *
 * 🔴 The weight column is not decoration. Freight is quoted against the summed
 * basket weight, and platform-wide most variants carry no weight at either
 * level — a line with no weight cannot be quoted, and the partner needs to see
 * that BEFORE minting rather than discover it in a quote that came back short.
 * The provenance ("product" vs "variant") matters too: a declared product
 * weight over-quotes a lighter variant, which at bulk quantities can cross a
 * carrier slab.
 */
const useQuoteGridColumns = (): ColumnDef<Row>[] => {
  const { t } = useTranslation()

  return useMemo(
    () => [
      columnHelper.column({
        id: "title",
        header: t("fields.title", "Product"),
        cell: (context) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return (
              <DataGrid.ReadonlyCell context={context}>
                <div className="flex h-full w-full items-center gap-x-2 overflow-hidden">
                  <Thumbnail src={entity.thumbnail} size="small" />
                  <span className="truncate">{entity.title}</span>
                </div>
              </DataGrid.ReadonlyCell>
            )
          }
          return (
            <DataGrid.ReadonlyCell context={context} color="normal">
              <span className="truncate">{entity.title}</span>
            </DataGrid.ReadonlyCell>
          )
        },
        disableHiding: true,
      }),
      columnHelper.column({
        id: "weight",
        header: t("quotes.fields.unitWeight", "Unit weight"),
        cell: (context) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return <DataGrid.ReadonlyCell context={context} />
          }

          const variantWeight = (entity as any).weight
          // The listing nests variants under their product, so the fallback
          // lives on the parent row — variants carry no back-reference here.
          const productWeight = (
            context.row.getParentRow()?.original as any
          )?.weight

          const resolved = variantWeight ?? productWeight ?? null
          const source = variantWeight != null ? "variant" : "product"

          return (
            <DataGrid.ReadonlyCell context={context} color="normal">
              {resolved == null ? (
                <span className="text-ui-fg-error truncate">
                  {t("quotes.fields.noWeight", "No weight — cannot quote")}
                </span>
              ) : (
                <span className="truncate">
                  {resolved} g
                  {source === "product" ? (
                    <span className="text-ui-fg-subtle"> (product)</span>
                  ) : null}
                </span>
              )}
            </DataGrid.ReadonlyCell>
          )
        },
      }),
      /**
       * The trade price (#1446). Two columns and not one, because the two
       * forms are genuinely different questions — "take 15% off the tier" and
       * "the price is 19,000" — and collapsing them into one field with a mode
       * toggle makes the grid guess which the partner meant.
       *
       * 🔴 The override is in the STORE's default currency, and the header
       * says so. A partner typing 19000 into a USD quote means rupees; the
       * conversion happens at mint, at a rate the quote records. A column that
       * did not name the currency would be read as the buyer's.
       */
      columnHelper.column({
        id: "discount_percent",
        name: t("quotes.fields.discountPercent", "Discount %"),
        header: t("quotes.fields.discountPercent", "Discount %"),
        field: (context) => {
          const entity = context.row.original
          if (isProductRow(entity)) return null
          return `discounts.${entity.id}` as const
        },
        type: "number",
        cell: (context) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return <DataGrid.ReadonlyCell context={context} />
          }
          return <DataGrid.NumberCell context={context} min={0} max={100} />
        },
      }),
      columnHelper.column({
        id: "override_unit_amount",
        name: t("quotes.fields.overrideUnitAmount", "Unit price"),
        header: t("quotes.fields.overrideUnitAmount", "Unit price (store currency)"),
        field: (context) => {
          const entity = context.row.original
          if (isProductRow(entity)) return null
          return `overrides.${entity.id}` as const
        },
        type: "number",
        cell: (context) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return <DataGrid.ReadonlyCell context={context} />
          }
          return <DataGrid.NumberCell context={context} min={0} />
        },
      }),
      columnHelper.column({
        id: "quantity",
        name: t("fields.quantity", "Quantity"),
        header: t("fields.quantity", "Quantity"),
        field: (context) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return null
          }
          return `quantities.${entity.id}` as const
        },
        type: "number",
        cell: (context) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return <DataGrid.ReadonlyCell context={context} />
          }
          return <DataGrid.NumberCell context={context} min={0} />
        },
      }),
    ],
    [t]
  )
}

export const QuoteQuantitiesForm = ({ form }: QuoteQuantitiesFormProps) => {
  const ids = useWatch({ control: form.control, name: "product_ids" })

  /**
   * ⚠️ `/partners/stores/:id/products` takes NO query params — it ignores
   * `req.query` and returns the store's whole channel-linked set unpaginated
   * (`list-store-products.ts` says so explicitly). Passing `id`/`fields` here
   * would look like a filter and silently do nothing, so the narrowing is done
   * where it actually happens: on the client.
   */
  const { products, isError, error } = useProducts()

  const selected = useMemo(() => {
    const wanted = new Set(ids.map((p) => p.id))
    return ((products ?? []) as Row[]).filter(
      (p) => isProductRow(p) && wanted.has(p.id)
    )
  }, [products, ids])

  const columns = useQuoteGridColumns()

  if (isError) {
    throw error
  }

  return (
    <div className="flex size-full flex-col gap-y-4 overflow-y-auto">
      <DataGrid
        columns={columns}
        data={selected}
        getSubRows={(row) => (isProductRow(row) ? row.variants ?? [] : undefined)}
        state={form}
      />
      {/*
        Below the grid, not inside it (#1501): a design is picked from hundreds
        by NAME, which is a search, and the grid is a numeric keyboard surface
        whose arrow-key navigation a combobox would fight.
      */}
      <QuoteLineDesignsPanel
        form={form}
        products={selected.filter(isProductRow)}
      />
    </div>
  )
}
