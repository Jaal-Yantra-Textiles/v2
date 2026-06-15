import { HttpTypes } from "@medusajs/types"
import { StatusBadge, createDataTableColumnHelper } from "@medusajs/ui"
import { createTableAdapter, TableAdapter } from "../../../../../lib/table/table-adapters"
import { useOrders } from "../../../../../hooks/api/orders"
import { useOrderTableFilters } from "./use-order-table-filters"
import { orderColumnAdapter } from "../../../../../lib/table/entity-adapters"
import { getStatusBadgeColor } from "../../../../../lib/status-badge"
import { PARTNER_STATUS_LABELS, getPartnerWorkStatus } from "../../../../../lib/work-status"
import { OrderKind } from "./order-kind"

// #342 — the work-order lifecycle field the "Work status" badge reads. Promoted
// onto the typed `unified_order_status.partner_status` sidecar column. Appended
// to the configurable table's required fields for work-order kinds so the column
// has data (retail rows have no work status, so retail skips it).
const WORK_STATUS_FIELD = "unified_order_status.partner_status"

const withWorkStatusField = (fields: string): string => {
  if (!fields) return WORK_STATUS_FIELD
  return fields.split(",").includes(WORK_STATUS_FIELD)
    ? fields
    : `${fields},${WORK_STATUS_FIELD}`
}

// Derived "Work status" column appended after the configurable columns for the
// design/inventory/all kinds (built with the configurable DataTable's helper).
const workColumnHelper = createDataTableColumnHelper<HttpTypes.AdminOrder>()
const workStatusColumn = workColumnHelper.display({
  id: "work_status",
  header: () => "Work status",
  cell: ({ row }: { row: any }) => {
    const status = getPartnerWorkStatus(row.original)
    if (!status) {
      return <span className="text-ui-fg-muted">—</span>
    }
    return (
      <StatusBadge color={getStatusBadgeColor(status)}>
        {PARTNER_STATUS_LABELS[status] ?? status}
      </StatusBadge>
    )
  },
}) as any

/**
 * Create the order table adapter with all order-specific logic. The `kind`
 * (#342) makes the configurable table filter natively by which unified link is
 * present, rather than deferring work-orders to the standard table.
 */
export function createOrderTableAdapter(
  kind: OrderKind = "retail"
): TableAdapter<HttpTypes.AdminOrder> {
  const isWorkOrderKind = kind !== "retail"

  return createTableAdapter<HttpTypes.AdminOrder>({
    entity: "orders",
    queryPrefix: "o",
    pageSize: 20,
    columnAdapter: orderColumnAdapter,
    // Work-order kinds carry a partner work-status badge the backend column
    // registry doesn't know about — append it as a derived column.
    extraColumns: isWorkOrderKind ? [workStatusColumn] : undefined,

    useData: (fields, params) => {
      const resolvedFields = isWorkOrderKind ? withWorkStatusField(fields) : fields
      const { orders, count, isError, error, isLoading } = useOrders(
        {
          ...params,
          fields: resolvedFields,
          kind,
        } as any,
        {
          placeholderData: (previousData: any, previousQuery: any) => {
            // Only keep placeholder data if the fields haven't changed
            const prevFields = previousQuery?.[previousQuery.length - 1]?.query?.fields
            if (prevFields && prevFields !== resolvedFields) {
              // Fields changed, don't use placeholder data
              return undefined
            }
            // Fields are the same, keep previous data for smooth transitions
            return previousData
          },
        }
      )

      return {
        data: orders,
        count,
        isLoading,
        isError,
        error,
      }
    },

    getRowHref: (row) => `/orders/${row.id}`,

    emptyState: {
      empty: {
        heading: "No orders found",
      }
    }
  })
}

/**
 * Hook to get the order table adapter with filters, scoped to a kind (#342).
 */
export function useOrderTableAdapter(
  kind: OrderKind = "retail"
): TableAdapter<HttpTypes.AdminOrder> {
  const filters = useOrderTableFilters()
  const adapter = createOrderTableAdapter(kind)

  // Add dynamic filters to the adapter
  return {
    ...adapter,
    filters,
  }
}
