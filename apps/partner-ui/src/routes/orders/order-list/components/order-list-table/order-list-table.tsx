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
import {
  PARTNER_STATUS_LABELS,
  getPartnerWorkStatus,
} from "../../../../../lib/work-status"
import { useOrderTableFilters } from "./use-order-table-filters"
import { useOrderTableQuery } from "../../../../../hooks/table/query/use-order-table-query"
import { useDataTable } from "../../../../../hooks/use-data-table"
import { useFeatureFlag } from "../../../../../providers/feature-flag-provider"
import { ConfigurableOrderListTable } from "./configurable-order-list-table"
import { deriveOrderKind, KIND_HEADINGS, isPureWorkOrderKind } from "./order-kind"

import { DEFAULT_FIELDS } from "../../const"

const PAGE_SIZE = 20

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
    const status = getPartnerWorkStatus(row.original)
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
  const kind = deriveOrderKind(pathname)

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
  // Design/inventory work-orders carry no customer, sales channel, or
  // payment/fulfillment status — those retail columns render empty, so hide them
  // for the pure work-order kinds and surface the real ones (order #, total,
  // date) plus the Work-status column. `all` keeps every column since it mixes
  // retail + work orders.
  const isPureWorkOrder = isPureWorkOrderKind(kind)
  const baseColumns = useOrderTableColumns({
    exclude: isPureWorkOrder
      ? ["customer", "sales_channel", "payment_status", "fulfillment_status", "country"]
      : [],
  })
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

  // view_configurations is an experimental flag. The configurable table is now
  // kind-aware itself (filters server-side by kind + appends the Work-status
  // column for work-orders), so ALL kinds route to it under the flag rather than
  // design/inventory/all deferring to this standard table.
  if (isViewConfigEnabled) {
    return <ConfigurableOrderListTable />
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
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
