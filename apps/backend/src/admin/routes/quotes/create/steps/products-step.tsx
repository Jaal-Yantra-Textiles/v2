import {
  Badge,
  Checkbox,
  DataTable,
  DataTablePaginationState,
  Heading,
  Label,
  Switch,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { UseFormReturn, useWatch } from "react-hook-form"

import { Thumbnail } from "../../../../components/common/thumbnail"
import { useProducts } from "../../../../hooks/api/products"
import { AdminQuoteCreateSchemaType } from "../schema"
import {
  useQuotableDesigns,
  type QuotableDesign,
} from "../../../../hooks/api/quotes"

type Props = { form: UseFormReturn<AdminQuoteCreateSchemaType> }

const PAGE_SIZE = 20

/**
 * Step 3 — what is in the basket, found either way.
 *
 * The same shape the partner wizard uses: a real table with server-side search
 * and pagination, not a `<Select>` of every variant in the catalogue. The
 * select was fine for a two-line demo and unusable against a real catalogue —
 * it loaded 100 products, flattened them to variants, and offered no way to
 * find one.
 *
 * 🔑 **Designs are a second way of finding the same variant, not a second
 * table.** They first shipped as a collapsible panel with its own search box
 * bolted above the products table, which gave the step two search fields, two
 * scroll areas and two mental models for one question — "what am I quoting?".
 * The switch swaps what the ONE table lists; search, paging, selection and the
 * per-variant maps below are shared, so a design and a product behave
 * identically once picked.
 *
 * 🔴 Deselecting DROPS the quantities its variants carried. Otherwise a line the
 * operator removed here would still be sent at the quantity they had typed, and
 * a quantity is a real price on a real price list.
 *
 * A product with no variants is not selectable: there would be nothing to
 * quote. A design with no single backing variant is shown, disabled, WITH its
 * reason — an admin who can see a design in the designs app and cannot find it
 * here has no way to learn that the fix is "create a product from it first".
 */
export const ProductsStep = ({ form }: Props) => {
  const { control, setValue } = form
  const selected = useWatch({ control, name: "product_ids" })
  const quantities = useWatch({ control, name: "quantities" })
  const discounts = useWatch({ control, name: "discounts" })
  const overrides = useWatch({ control, name: "overrides" })
  const designByVariant = useWatch({ control, name: "design_by_variant" })

  /**
   * 🔑 Designs are listed UNSCOPED — every design, not just the chosen
   * partner's. An admin legitimately quotes a design the producing partner does
   * not own, and narrowing the list by partner hid exactly those designs while
   * looking like an empty catalogue ("No designs found for this partner").
   *
   * This is safe because it is not the permission: the mint still asserts the
   * resolved variant is in that partner's sales channel, which is the check
   * that actually matters and the one that cannot be bypassed from here.
   */
  const [mode, setMode] = useState<"products" | "designs">("products")

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [search, setSearch] = useState("")

  const showDesigns = mode === "designs"

  const { products, count: productCount, isLoading: productsLoading } =
    useProducts(
      {
        limit: pagination.pageSize,
        offset: pagination.pageIndex * pagination.pageSize,
        ...(search ? { q: search } : {}),
      } as any,
      { placeholderData: keepPreviousData, enabled: !showDesigns }
    )

  const { designs, count: designCount, isLoading: designsLoading } =
    useQuotableDesigns(
      {
        limit: pagination.pageSize,
        offset: pagination.pageIndex * pagination.pageSize,
        ...(search ? { q: search } : {}),
      },
      { placeholderData: keepPreviousData, enabled: showDesigns } as any
    )

  const selectedIds = useMemo(
    () => new Set((selected ?? []).map((p) => p.id)),
    [selected]
  )

  const pickedDesigns = useMemo(
    () => new Set(Object.values(designByVariant ?? {})),
    [designByVariant]
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
      // #1486 — the fourth per-variant map. A design mapping left behind would
      // reattach itself the moment the same product is picked again, stamping a
      // design onto a line nobody chose it for.
      setValue("design_by_variant", prune(designByVariant), { shouldDirty: true })
    }
  }

  /**
   * #1486 — picking a design selects the PRODUCT behind it, so its variant
   * appears in the quantities step like any other, and records which design it
   * was so the mint carries the provenance.
   */
  const toggleDesign = (design: QuotableDesign, isSelected: boolean) => {
    if (!design.variant_id || !design.product_id) return

    const nextMap = { ...(designByVariant ?? {}) }
    const ids = new Set(selectedIds)

    if (isSelected) {
      nextMap[design.variant_id] = design.id
      ids.add(design.product_id)
    } else {
      delete nextMap[design.variant_id]
      ids.delete(design.product_id)
      // The quantity goes with it, for the same reason deselecting a product
      // drops one: a line the operator removed must not still be sent.
      const nextQuantities = { ...(quantities ?? {}) }
      delete nextQuantities[design.variant_id]
      setValue("quantities", nextQuantities, { shouldDirty: true })
    }

    setValue(
      "product_ids",
      [...ids].map((id) => ({ id })),
      { shouldDirty: true, shouldTouch: true }
    )
    setValue("design_by_variant", nextMap, { shouldDirty: true })
  }

  const productColumns = useMemo(
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

  const designColumns = useMemo(
    () => [
      {
        id: "select",
        header: "",
        cell: ({ row }: any) => {
          const design = row.original as QuotableDesign
          return (
            <Checkbox
              checked={pickedDesigns.has(design.id)}
              // Disabled, not hidden — the reason has to be readable.
              disabled={!design.quotable}
              onCheckedChange={(value) => toggleDesign(design, !!value)}
            />
          )
        },
        size: 36,
      },
      {
        id: "name",
        header: "Design",
        cell: ({ row }: any) => {
          const design = row.original as QuotableDesign
          return (
            <div className="flex items-center gap-x-3">
              <Thumbnail src={design.thumbnail_url ?? undefined} size="small" />
              <span className="truncate">{design.name ?? design.id}</span>
            </div>
          )
        },
      },
      {
        id: "quotable",
        header: "Quotable",
        cell: ({ row }: any) => {
          const design = row.original as QuotableDesign
          // The reason, in the row, not behind a tooltip: it is the whole
          // instruction for making this design quotable.
          return design.quotable ? (
            "Yes"
          ) : (
            <span className="text-ui-fg-muted">
              {design.reason ?? "Cannot quote"}
            </span>
          )
        },
      },
      {
        id: "product_type",
        header: "Type",
        cell: ({ row }: any) =>
          row.original.product_type ? (
            <Badge size="2xsmall">{row.original.product_type}</Badge>
          ) : (
            "—"
          ),
      },
    ],
    [pickedDesigns, selectedIds, quantities]
  )

  const table = useDataTable({
    columns: (showDesigns ? designColumns : productColumns) as any,
    data: ((showDesigns ? designs : products) ?? []) as any[],
    getRowId: (row: any) => row.id,
    rowCount: (showDesigns ? designCount : productCount) ?? 0,
    isLoading: showDesigns ? designsLoading : productsLoading,
    onRowClick: (_e: any, row: any) => {
      const original = row.original ?? row
      if (!showDesigns) {
        toggle(original)
        return
      }
      const design = original as QuotableDesign
      if (!design.quotable) return
      toggleDesign(design, !pickedDesigns.has(design.id))
    },
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
        <DataTable.Toolbar className="flex items-center justify-between gap-x-4 px-6 py-4">
          <div className="flex items-center gap-x-2">
            <Switch
              id="quote-browse-designs"
              checked={showDesigns}
              onCheckedChange={(checked) => {
                setMode(checked ? "designs" : "products")
                // Both lists are searched and paged server-side, so carrying
                // either across the switch would ask one endpoint for the
                // other's page and show an empty table on a full catalogue.
                setSearch("")
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
            />
            <Label htmlFor="quote-browse-designs" weight="plus" size="small">
              Browse designs
            </Label>
            {pickedDesigns.size > 0 ? (
              <Badge size="2xsmall">{pickedDesigns.size} picked</Badge>
            ) : null}
          </div>
          <DataTable.Search
            placeholder={showDesigns ? "Search designs..." : "Search products..."}
          />
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </div>
  )
}
