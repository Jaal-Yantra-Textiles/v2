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

type QuoteQuantitiesFormProps = {
  form: UseFormReturn<QuoteCreateSchemaType>
}

type Row = HttpTypes.AdminProduct | HttpTypes.AdminProductVariant

const isProductRow = (row: Row): row is HttpTypes.AdminProduct =>
  "variants" in row

const columnHelper = createDataGridHelper<Row, QuoteCreateSchemaType>()

/**
 * Step 3 — how many of each variant.
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
    <DataGrid
      columns={columns}
      data={selected}
      getSubRows={(row) => (isProductRow(row) ? row.variants ?? [] : undefined)}
      state={form}
    />
  )
}
