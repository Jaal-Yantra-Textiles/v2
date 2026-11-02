import { TriangleRightMini } from "@medusajs/icons"
import { Badge, IconButton, Text, clx } from "@medusajs/ui"
import { ColumnDef, createColumnHelper } from "@tanstack/react-table"
import { useEffect, useMemo } from "react"

import { useDesignWorkOrders } from "../../hooks/api/design-work-orders"
import { getStatusColor } from "../../hooks/columns/useDesignsTableColumns"
import { useDataTable } from "../../hooks/usedataTable"
import { BundleDesignRow, BundleRow, buildBundleRows } from "../../lib/design-bundles"
import { designWorkOrderHref } from "../../lib/work-order-href"
import { DataTableRoot } from "../table/data-table-root"
import { TableSkeleton } from "../table/skeleton"

/**
 * Designs bundled the way they are produced: one expandable row per collated
 * design work order (Collate wizard / produce_designs), its designs nested
 * underneath — the same shape as Products → Categories. A bundle row opens
 * the work order; a design row opens the design.
 */

type Row = BundleRow | BundleDesignRow

// Every collated order, newest first. The route pages in memory and has no
// hard cap; 200 is far above today's count.
const BUNDLES_QUERY = { limit: 200, offset: 0 }

const columnHelper = createColumnHelper<Row>()

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""

export const DesignBundles = () => {
  const { design_work_orders, designs, partners, isLoading, isError, error } =
    useDesignWorkOrders(BUNDLES_QUERY)

  const rows = useMemo<Row[]>(
    () => buildBundleRows(design_work_orders as any, designs, partners),
    [design_work_orders, designs, partners]
  )

  const columns = useMemo<ColumnDef<Row, any>[]>(
    () => [
      columnHelper.display({
        id: "name",
        header: "Bundle / design",
        cell: ({ row }) => {
          const r = row.original
          if (r.kind === "bundle") {
            return (
              <div className="flex items-center gap-x-2">
                <IconButton
                  size="2xsmall"
                  variant="transparent"
                  type="button"
                  aria-label={row.getIsExpanded() ? `Collapse ${r.label}` : `Expand ${r.label}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    row.toggleExpanded()
                  }}
                >
                  <TriangleRightMini
                    className={clx("text-ui-fg-subtle transition-transform", {
                      "rotate-90": row.getIsExpanded(),
                    })}
                  />
                </IconButton>
                <div className="flex flex-col">
                  <Text size="small" weight="plus" leading="compact">
                    {r.label} · {r.partner}
                  </Text>
                  <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
                    {r.design_count} design{r.design_count === 1 ? "" : "s"} · {formatDate(r.created_at)}
                  </Text>
                </div>
              </div>
            )
          }
          return (
            <Text size="small" leading="compact" className="truncate">
              {r.name}
            </Text>
          )
        },
      }),
      columnHelper.display({
        id: "pieces",
        header: "Pieces",
        cell: ({ row }) =>
          row.original.kind === "bundle" ? row.original.pieces : row.original.quantity,
      }),
      columnHelper.display({
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const r = row.original
          if (r.kind === "bundle") {
            return r.status ? (
              <Badge size="2xsmall" color="grey">
                {r.status.replace(/_/g, " ")}
              </Badge>
            ) : null
          }
          return (
            <div className="flex items-center gap-x-1">
              {r.run_status ? (
                <Badge size="2xsmall" color="blue">
                  {r.run_status.replace(/_/g, " ")}
                </Badge>
              ) : null}
              {r.design_status ? (
                <Badge size="2xsmall" color={getStatusColor(r.design_status)}>
                  {r.design_status.replace(/_/g, " ")}
                </Badge>
              ) : null}
            </div>
          )
        },
      }),
    ],
    []
  )

  const { table } = useDataTable<Row>({
    data: rows,
    columns,
    count: rows.length,
    enablePagination: false,
    enableExpandableRows: true,
    getRowId: (row) => row.id,
    getSubRows: (row) => (row.kind === "bundle" ? (row.children as Row[]) : undefined) as Row[],
  })

  // Open every bundle once the data is in; re-run only when the set of
  // bundles changes, so a user's own toggling survives a refetch.
  const bundleKey = rows.map((r) => r.id).join("|")
  useEffect(() => {
    if (!rows.length) return
    table.setExpanded(Object.fromEntries(rows.map((r) => [r.id, true])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleKey])

  if (isError) {
    throw error
  }

  if (isLoading) {
    return (
      <TableSkeleton layout="fit" rowCount={10} search={false} filters={false} orderBy={false} pagination={false} />
    )
  }

  if (!rows.length) {
    return (
      <div className="px-6 py-8">
        <Text size="small" className="text-ui-fg-subtle">
          No bundles yet. Select designs in the list and use Collate to send them to a partner together.
        </Text>
      </div>
    )
  }

  return (
    <DataTableRoot
      table={table}
      columns={columns}
      count={rows.length}
      navigateTo={(row) =>
        row.original.kind === "bundle"
          ? designWorkOrderHref(row.original.order_id)
          : `/designs/${row.original.design_id}`
      }
      layout="fit"
    />
  )
}
