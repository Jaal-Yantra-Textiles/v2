import { TriangleRightMini } from "@medusajs/icons"
import { Badge, IconButton, Text, clx } from "@medusajs/ui"
import { ColumnDef, createColumnHelper } from "@tanstack/react-table"
import { useEffect, useMemo } from "react"

import { AdminDesign, useDesigns } from "../../hooks/api/designs"
import { getStatusColor } from "../../hooks/columns/useDesignsTableColumns"
import { useDataTable } from "../../hooks/usedataTable"
import {
  NO_COLLECTION_ID,
  groupDesignsByCollection,
} from "../../lib/design-collections"
import { DataTableRoot } from "../table/data-table-root"
import { TableSkeleton } from "../table/skeleton"

/**
 * Designs grouped by collection, as a collapsible tree — the same shape as
 * Products → Categories. A collection is a `collection:<name>` tag (see
 * lib/design-collections.ts). Collections open expanded; "No collection"
 * starts collapsed so the grouped work is what you see first.
 */

type GroupRow = {
  kind: "group"
  id: string
  name: string
  count: number
  children: DesignRow[]
}

type DesignRow = {
  kind: "design"
  id: string
  design: AdminDesign
}

type Row = GroupRow | DesignRow

// Every design, in one request: grouping must see all of them, and the list
// route has no page-size cap. 163 designs on 2026-11-02.
const ALL_DESIGNS = { limit: 1000, offset: 0 }

const columnHelper = createColumnHelper<Row>()

export const DesignsByCollection = () => {
  const { designs, isLoading, isError, error } = useDesigns(ALL_DESIGNS as any)

  const rows = useMemo<Row[]>(
    () =>
      groupDesignsByCollection(designs).map((group) => ({
        kind: "group" as const,
        id: group.id,
        name: group.name,
        count: group.designs.length,
        children: group.designs.map((design) => ({
          kind: "design" as const,
          // A design in two collections appears twice, so the row id is
          // scoped by its group.
          id: `${group.id}/${design.id}`,
          design,
        })),
      })),
    [designs]
  )

  const columns = useMemo<ColumnDef<Row, any>[]>(
    () => [
      columnHelper.display({
        id: "name",
        header: "Collection / design",
        cell: ({ row }) => {
          const r = row.original
          if (r.kind === "group") {
            return (
              <div className="flex items-center gap-x-2">
                <IconButton
                  size="2xsmall"
                  variant="transparent"
                  type="button"
                  aria-label={row.getIsExpanded() ? `Collapse ${r.name}` : `Expand ${r.name}`}
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
                <Text size="small" weight="plus" leading="compact">
                  {r.name}
                </Text>
                <Badge size="2xsmall" color="grey">
                  {r.count}
                </Badge>
              </div>
            )
          }
          return (
            <Text size="small" leading="compact" className="truncate">
              {r.design.name}
            </Text>
          )
        },
      }),
      columnHelper.display({
        id: "product_type",
        header: "Type",
        cell: ({ row }) =>
          row.original.kind === "design"
            ? (row.original.design.product_type || "-").replace(/_/g, " ")
            : null,
      }),
      columnHelper.display({
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          if (row.original.kind !== "design") return null
          const status = row.original.design.status
          return status ? (
            <Badge size="2xsmall" color={getStatusColor(status)}>
              {status.replace(/_/g, " ")}
            </Badge>
          ) : (
            "-"
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
    getSubRows: (row) => (row.kind === "group" ? (row.children as Row[]) : undefined) as Row[],
  })

  // Open every real collection once the data is in; leave "No collection"
  // closed. Re-run only when the set of groups changes, so a user's own
  // toggling is not undone by a refetch.
  const groupKey = rows.map((r) => r.id).join("|")
  useEffect(() => {
    if (!rows.length) return
    table.setExpanded(
      Object.fromEntries(
        rows.filter((r) => r.id !== NO_COLLECTION_ID).map((r) => [r.id, true])
      )
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey])

  if (isError) {
    throw error
  }

  if (isLoading) {
    return (
      <TableSkeleton layout="fit" rowCount={10} search={false} filters={false} orderBy={false} pagination={false} />
    )
  }

  return (
    <DataTableRoot
      table={table}
      columns={columns}
      count={rows.length}
      navigateTo={(row) =>
        row.original.kind === "design" ? `/designs/${row.original.design.id}` : ""
      }
      noResults={!rows.length}
      layout="fit"
    />
  )
}
