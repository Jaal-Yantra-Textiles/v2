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
import { QuoteCreateSchemaType } from "./schema"

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

    setRowSelection(state)
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
    <div className="flex size-full flex-col">
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
