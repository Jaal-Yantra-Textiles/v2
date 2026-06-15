import { Container, Heading, StatusBadge } from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { createColumnHelper } from "@tanstack/react-table"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router-dom"

import { _DataTable } from "../../../../../components/table/data-table/data-table"
import { useOrders } from "../../../../../hooks/api/orders"
import { usePartnerStores } from "../../../../../hooks/api/partner-stores"
import { useOrderTableColumns } from "../../../../../hooks/table/columns/use-order-table-columns"
import { getStatusBadgeColor } from "../../../../../lib/status-badge"
import { useOrderTableFilters } from "./use-order-table-filters"
import { useOrderTableQuery } from "../../../../../hooks/table/query/use-order-table-query"
import { useDataTable } from "../../../../../hooks/use-data-table"
import { useFeatureFlag } from "../../../../../providers/feature-flag-provider"
import { ConfigurableOrderListTable } from "./configurable-order-list-table"

import { DEFAULT_FIELDS } from "../../const"

const PAGE_SIZE = 20

type OrderKind = "retail" | "design" | "inventory" | "all"

// `/orders` (index) == retail; `/orders/{design,inventory,all}` opt into the
// other unified panels (#342 Chunk 5). The detail route `/orders/:id` renders a
// different component, so the segment after "orders" here is always a kind.
const deriveKind = (pathname: string): OrderKind => {
  const seg = pathname.split("/").filter(Boolean)[1]
  return seg === "design" || seg === "inventory" || seg === "all"
    ? (seg as OrderKind)
    : "retail"
}

// The §5 work-progress vocabulary. Promoted to the typed
// `unified_order_status.partner_status` column (PR-F); read off the column
// first, with `metadata.partner_status` as a transitional fallback (PR-G).
const PARTNER_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  accepted: "Accepted",
  in_progress: "In Progress",
  partial: "Partial",
  finished: "Finished",
  completed: "Completed",
  declined: "Declined",
}

// The order-kind views are reached from the nested "Orders" sidebar submenu
// (#342 Chunk 5). The heading reflects which kind is active.
const KIND_HEADINGS: Record<OrderKind, string> = {
  retail: "Orders",
  design: "Design Orders",
  inventory: "Inventory Orders",
  all: "All Orders",
}

// Work-order-only column: the partner-facing lifecycle status. Shown on the
// design/inventory/all tabs; retail rows have no partner_status and render "—".
const workColumnHelper = createColumnHelper<any>()
const partnerStatusColumn = workColumnHelper.display({
  id: "partner_status",
  header: () => (
    <div className="flex h-full w-full items-center px-4 py-2.5">
      Work status
    </div>
  ),
  cell: ({ row }) => {
    const status = (row.original?.unified_order_status?.partner_status ??
      row.original?.metadata?.partner_status) as string | undefined
    if (!status) {
      return <span className="text-ui-fg-muted px-4">—</span>
    }
    return (
      <div className="flex items-center px-4">
        <StatusBadge color={getStatusBadgeColor(status)}>
          {PARTNER_STATUS_LABELS[status] ?? status}
        </StatusBadge>
      </div>
    )
  },
})

export const OrderListTable = () => {
  const { t } = useTranslation()
  const { stores } = usePartnerStores()
  const hasStore = stores?.length > 0
  const isViewConfigEnabled = useFeatureFlag("view_configurations")
  const { pathname } = useLocation()
  const kind = deriveKind(pathname)

  const { searchParams, raw } = useOrderTableQuery({
    pageSize: PAGE_SIZE,
  })

  const { orders, count, isError, error, isLoading } = useOrders(
    {
      fields: DEFAULT_FIELDS,
      kind,
      ...searchParams,
    } as any,
    {
      placeholderData: keepPreviousData,
    }
  )

  const filters = useOrderTableFilters()
  const baseColumns = useOrderTableColumns({})
  const columns = useMemo(
    () =>
      kind === "retail" ? baseColumns : [...baseColumns, partnerStatusColumn],
    [baseColumns, kind]
  )

  const { table } = useDataTable({
    data: orders ?? [],
    columns,
    enablePagination: true,
    count,
    pageSize: PAGE_SIZE,
  })

  if (isError) {
    throw error
  }

  // view_configurations is an experimental flag; the kind sub-routes/tabs are
  // wired through the standard table only. (When the flag is on, all kinds fall
  // back to the configurable table unfiltered.)
  if (isViewConfigEnabled) {
    return <ConfigurableOrderListTable />
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading>{kind === "retail" ? t("orders.domain") : KIND_HEADINGS[kind]}</Heading>
      </div>
      <_DataTable
        columns={columns}
        table={table}
        pagination
        navigateTo={(row) => `/orders/${row.original.id}`}
        filters={filters}
        count={count}
        search
        isLoading={isLoading}
        pageSize={PAGE_SIZE}
        orderBy={[
          { key: "display_id", label: t("orders.fields.displayId") },
          { key: "created_at", label: t("fields.createdAt") },
          { key: "updated_at", label: t("fields.updatedAt") },
        ]}
        queryObject={raw}
        noRecords={{
          message: !hasStore
            ? "No store configured for this partner. Please set up a store to manage orders."
            : t("orders.list.noRecordsMessage"),
        }}
      />
    </Container>
  )
}
