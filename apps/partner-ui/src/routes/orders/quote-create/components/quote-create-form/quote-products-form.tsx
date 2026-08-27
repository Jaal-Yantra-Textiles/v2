import { HttpTypes } from "@medusajs/types"
import { Checkbox } from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import {
  OnChangeFn,
  RowSelectionState,
  createColumnHelper,
} from "@tanstack/react-table"
import { useMemo, useState } from "react"
import { UseFormReturn, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { _DataTable } from "../../../../../components/table/data-table"
import { useProducts } from "../../../../../hooks/api/products"
import { useProductTableColumns } from "../../../../../hooks/table/columns/use-product-table-columns"
import { useProductTableFilters } from "../../../../../hooks/table/filters/use-product-table-filters"
import { useProductTableQuery } from "../../../../../hooks/table/query/use-product-table-query"
import { useDataTable } from "../../../../../hooks/use-data-table"
import { QuoteDesignsPanel } from "./quote-designs-panel"
import { QuoteCreateSchemaType } from "./schema"
import type { QuotableDesign } from "../../../../../hooks/api/partner-quotes"

type QuoteProductsFormProps = {
  form: UseFormReturn<QuoteCreateSchemaType>
}

const PAGE_SIZE = 50
const PREFIX = "qp"

function getInitialSelection(products: { id: string }[]) {
  return products.reduce((acc, curr) => {
    acc[curr.id] = true
    return acc
  }, {} as RowSelectionState)
}

/**
 * Step 2 — which products are in the basket.
 *
 * The same picker the price-list create flow uses, pointed at the partner's own
 * catalogue (`useProducts` resolves `/partners/stores/:id/products`). A product
 * with no variants cannot be selected — there would be nothing to quote.
 */
export const QuoteProductsForm = ({ form }: QuoteProductsFormProps) => {
  const { t } = useTranslation()
  const { control, setValue } = form

  const selectedIds = useWatch({ control, name: "product_ids" })
  const quantities = useWatch({ control, name: "quantities" })
  const designByVariant = useWatch({ control, name: "design_by_variant" })
  // The buyer step sets it; a made-to-order variant has to be listed in it.
  const watchedCurrency = useWatch({ control, name: "currency_code" })

  const [rowSelection, setRowSelection] = useState<RowSelectionState>(
    getInitialSelection(selectedIds)
  )

  const { searchParams, raw } = useProductTableQuery({
    pageSize: PAGE_SIZE,
    prefix: PREFIX,
  })

  const { products, count, isLoading, isError, error } = useProducts(
    searchParams,
    { placeholderData: keepPreviousData }
  )

  const updater: OnChangeFn<RowSelectionState> = (fn) => {
    const state = typeof fn === "function" ? fn(rowSelection) : fn
    const ids = Object.keys(state)

    setValue(
      "product_ids",
      ids.map((id) => ({ id })),
      { shouldDirty: true, shouldTouch: true }
    )

    // Deselecting a product must drop the quantities its variants carried —
    // otherwise a line the partner removed here would still be sent, and a
    // quantity is a real price on a real price list.
    const stillSelected = new Set(ids)
    const keptQuantities = Object.entries(quantities ?? {}).reduce(
      (acc, [variantId, qty]) => {
        const owner = (products || []).find((p: any) =>
          (p.variants ?? []).some((v: any) => v.id === variantId)
        )
        if (!owner || stillSelected.has(owner.id)) {
          acc[variantId] = qty
        }
        return acc
      },
      {} as Record<string, number | null | undefined>
    )

    setValue("quantities", keptQuantities, {
      shouldDirty: true,
      shouldTouch: true,
    })

    // #1486 — and the design mapping with it, by the SAME rule the quantities
    // use: keep it while its product is still selected.
    //
    // 🔴 Not "keep it if it has a quantity". A design is picked before any
    // quantity is typed, so that rule would silently drop every design mapping
    // the moment the partner touched another row — and the quote would mint
    // correctly priced with the provenance gone.
    const keptDesigns = Object.entries(designByVariant ?? {}).reduce(
      (acc, [variantId, designId]) => {
        const owner = (products || []).find((p: any) =>
          (p.variants ?? []).some((v: any) => v.id === variantId)
        )
        if (!owner || stillSelected.has(owner.id)) {
          acc[variantId] = designId
        }
        return acc
      },
      {} as Record<string, string>
    )
    setValue("design_by_variant", keptDesigns, { shouldDirty: true })

    setRowSelection(state)
  }

  /**
   * #1486 — picking a design selects the PRODUCT behind it, so its variant
   * shows up in the quantities step exactly like any other, and records which
   * design it was so the mint can carry the provenance.
   *
   * 🔑 `product_ids` is the source of truth for the next step; `rowSelection`
   * is only the table's tick marks, and the product may not even be on the
   * current page. Both are set, but they are not the same fact.
   */
  const toggleDesign = (design: QuotableDesign, selected: boolean) => {
    if (!design.variant_id || !design.product_id) return

    const nextMap = { ...(designByVariant ?? {}) }
    const currentIds = (selectedIds ?? []).map((p) => p.id)

    if (selected) {
      nextMap[design.variant_id] = design.id
      if (!currentIds.includes(design.product_id)) {
        setValue("product_ids", [...(selectedIds ?? []), { id: design.product_id }], {
          shouldDirty: true,
          shouldTouch: true,
        })
        setRowSelection((prev) => ({ ...prev, [design.product_id as string]: true }))
      }
    } else {
      delete nextMap[design.variant_id]
      setValue(
        "product_ids",
        (selectedIds ?? []).filter((p) => p.id !== design.product_id),
        { shouldDirty: true, shouldTouch: true }
      )
      setRowSelection((prev) => {
        const next = { ...prev }
        delete next[design.product_id as string]
        return next
      })
      // The quantity has to go with it — a line the partner just removed must
      // not still be sent, and a quantity is a real price on a real price list.
      const nextQuantities = { ...(quantities ?? {}) }
      delete nextQuantities[design.variant_id]
      setValue("quantities", nextQuantities, { shouldDirty: true })
    }

    setValue("design_by_variant", nextMap, { shouldDirty: true })
  }

  const columns = useColumns()
  const filters = useProductTableFilters()

  const { table } = useDataTable({
    data: products || [],
    columns,
    count,
    enablePagination: true,
    enableRowSelection: (row: any) => !!row.original.variants?.length,
    getRowId: (row: any) => row.id,
    rowSelection: { state: rowSelection, updater },
    pageSize: PAGE_SIZE,
    prefix: PREFIX,
  })

  if (isError) {
    throw error
  }

  return (
    <div className="flex size-full flex-col gap-y-3">
      <QuoteDesignsPanel
        designByVariant={(designByVariant ?? {}) as Record<string, string>}
        onToggle={toggleDesign}
        // A made-to-order variant is listed in the quote's currency, not the
        // design's — see the panel.
        currencyCode={watchedCurrency}
      />
      <_DataTable
        table={table}
        columns={columns}
        filters={filters}
        pageSize={PAGE_SIZE}
        prefix={PREFIX}
        count={count}
        isLoading={isLoading}
        layout="fill"
        orderBy={[
          { key: "title", label: t("fields.title") },
          { key: "status", label: t("fields.status") },
          { key: "created_at", label: t("fields.createdAt") },
        ]}
        pagination
        search
        queryObject={raw}
        noRecords={{
          message: t(
            "quotes.create.products.noRecords",
            "No products to quote yet."
          ),
        }}
      />
    </div>
  )
}

const columnHelper = createColumnHelper<HttpTypes.AdminProduct>()

const useColumns = () => {
  const base = useProductTableColumns()

  return useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : table.getIsAllPageRowsSelected()
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      }),
      ...base,
    ],
    [base]
  )
}
