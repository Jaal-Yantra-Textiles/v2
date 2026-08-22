import {
  Checkbox,
  DataTable,
  DataTablePaginationState,
  Heading,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { UseFormReturn, useWatch } from "react-hook-form"

import { Thumbnail } from "../../../../components/common/thumbnail"
import { useProducts } from "../../../../hooks/api/products"
import { AdminQuoteCreateSchemaType } from "../schema"

type Props = { form: UseFormReturn<AdminQuoteCreateSchemaType> }

const PAGE_SIZE = 20

/**
 * Step 3 — which products are in the basket.
 *
 * The same shape the partner wizard uses: a real table with server-side search
 * and pagination, not a `<Select>` of every variant in the catalogue. The
 * select was fine for a two-line demo and unusable against a real catalogue —
 * it loaded 100 products, flattened them to variants, and offered no way to
 * find one.
 *
 * 🔴 Deselecting a product DROPS the quantities its variants carried. Otherwise
 * a line the operator removed here would still be sent at the quantity they
 * had typed, and a quantity is a real price on a real price list.
 *
 * A product with no variants is not selectable: there would be nothing to
 * quote.
 */
export const ProductsStep = ({ form }: Props) => {
  const { control, setValue } = form
  const selected = useWatch({ control, name: "product_ids" })
  const quantities = useWatch({ control, name: "quantities" })
  const discounts = useWatch({ control, name: "discounts" })
  const overrides = useWatch({ control, name: "overrides" })

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [search, setSearch] = useState("")

  const { products, count, isLoading } = useProducts(
    {
      limit: pagination.pageSize,
      offset: pagination.pageIndex * pagination.pageSize,
      ...(search ? { q: search } : {}),
    } as any,
    { placeholderData: keepPreviousData }
  )

  const selectedIds = useMemo(
    () => new Set((selected ?? []).map((p) => p.id)),
    [selected]
  )

  const toggle = (product: any) => {
    if (!(product.variants ?? []).length) return

    const next = new Set(selectedIds)
    if (next.has(product.id)) {
      next.delete(product.id)
    } else {
      next.add(product.id)
    }

    setValue(
      "product_ids",
      [...next].map((id) => ({ id })),
      { shouldDirty: true, shouldTouch: true }
    )

    if (selectedIds.has(product.id)) {
      // Removed — drop everything keyed on its variants, across all three
      // per-variant maps. Leaving a stale override behind would price a line
      // the operator believes they deleted.
      const orphans = new Set(
        ((product.variants ?? []) as any[]).map((v) => v.id)
      )
      const prune = (map: Record<string, any> | undefined) =>
        Object.fromEntries(
          Object.entries(map ?? {}).filter(([variantId]) => !orphans.has(variantId))
        )

      setValue("quantities", prune(quantities), { shouldDirty: true })
      setValue("discounts", prune(discounts), { shouldDirty: true })
      setValue("overrides", prune(overrides), { shouldDirty: true })
    }
  }

  const columns = useMemo(
    () => [
      {
        id: "select",
        header: "",
        cell: ({ row }: any) => {
          const product = row.original
          const noVariants = !(product.variants ?? []).length
          return (
            <Checkbox
              checked={selectedIds.has(product.id)}
              disabled={noVariants}
              onCheckedChange={() => toggle(product)}
            />
          )
        },
        size: 36,
      },
      {
        id: "title",
        header: "Product",
        cell: ({ row }: any) => (
          <div className="flex items-center gap-x-3">
            <Thumbnail src={row.original.thumbnail} size="small" />
            <span className="truncate">{row.original.title}</span>
          </div>
        ),
      },
      {
        id: "variants",
        header: "Variants",
        cell: ({ row }: any) => {
          const n = (row.original.variants ?? []).length
          // Named, not blank: "0" here is the reason the row cannot be picked,
          // and an operator hunting for a missing product needs to see why.
          return n === 0 ? (
            <span className="text-ui-fg-muted">No variants — cannot quote</span>
          ) : (
            `${n}`
          )
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }: any) => row.original.status ?? "—",
      },
    ],
    [selectedIds, quantities, discounts, overrides]
  )

  const table = useDataTable({
    columns: columns as any,
    data: (products ?? []) as any[],
    getRowId: (row: any) => row.id,
    rowCount: count ?? 0,
    isLoading,
    onRowClick: (_e: any, row: any) => toggle(row.original ?? row),
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: {
      state: search,
      onSearchChange: (value: string) => {
        setSearch(value)
        setPagination((prev) => ({ ...prev, pageIndex: 0 }))
      },
    },
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-y-1 px-6 pt-6">
        <Heading level="h2">Products</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Pick everything this buyer is being quoted. The whole basket ships as
          ONE consignment, so freight is charged once across all of it.
        </Text>
      </div>
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-end px-6 py-4">
          <DataTable.Search placeholder="Search products..." />
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </div>
  )
}
