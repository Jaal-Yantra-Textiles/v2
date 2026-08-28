import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Container, Badge, DataTable, StatusBadge, useDataTable } from "@medusajs/ui"
import { createColumnHelper } from "@tanstack/react-table"
import { keepPreviousData } from "@tanstack/react-query"
import {
  useReconciliations,
  type PaymentReconciliation,
} from "../../../hooks/api/payment-submissions"
import { RefLink } from "../../../components/payments/payment-line-links"

const columnHelper = createColumnHelper<PaymentReconciliation>()

const statusColor = (
  status: string
): "green" | "orange" | "red" | "grey" | "blue" | "purple" => {
  switch (status) {
    case "Matched":
      return "green"
    case "Settled":
      return "blue"
    case "Pending":
      return "orange"
    case "Discrepant":
      return "red"
    case "Waived":
      return "grey"
    default:
      return "grey"
  }
}

export const ReconciliationTab = () => {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState<string>("")

  const query = useMemo(
    () => ({
      limit: pagination.pageSize,
      offset: pagination.pageIndex * pagination.pageSize,
    }),
    [pagination]
  )

  const {
    reconciliations,
    count,
    isPending: isLoading,
  } = useReconciliations(query, {
    placeholderData: keepPreviousData,
  })

  const columns = useMemo(
    () => [
      columnHelper.accessor("id", {
        header: "ID",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue().slice(0, 12)}...</span>
        ),
      }),
      columnHelper.accessor("reference_type", {
        header: "Type",
        cell: ({ getValue }) => (
          <Badge color="grey">{getValue().replace("_", " ")}</Badge>
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => (
          <StatusBadge color={statusColor(getValue())}>{getValue()}</StatusBadge>
        ),
      }),
      columnHelper.accessor("expected_amount", {
        header: "Expected",
        cell: ({ getValue }) => `₹${Number(getValue()).toLocaleString()}`,
      }),
      columnHelper.accessor("actual_amount", {
        header: "Actual",
        cell: ({ getValue }) =>
          getValue() != null ? `₹${Number(getValue()).toLocaleString()}` : "—",
      }),
      columnHelper.accessor("discrepancy", {
        header: "Discrepancy",
        cell: ({ getValue }) => {
          const val = getValue()
          if (val == null) return "—"
          const num = Number(val)
          const color = num === 0 ? "" : num > 0 ? "text-ui-fg-positive" : "text-ui-fg-error"
          return <span className={color}>{num > 0 ? "+" : ""}{num.toLocaleString()}</span>
        },
      }),
      /**
       * 🔴 Was a truncated ULID — `01K4PJMNMNRG...` — repeated down the column.
       * This is the screen where a discrepancy is chased, and a column of
       * indistinguishable ids is the least useful place to be told nothing
       * (#1622). Name and link now; the id is still the title attribute.
       */
      columnHelper.accessor("partner_id", {
        header: "Partner",
        cell: ({ row }) =>
          row.original.partner_id ? (
            <RefLink
              kind="partner"
              refOrId={row.original.partner || row.original.partner_id}
              className="text-ui-fg-interactive text-xs hover:underline"
            />
          ) : (
            "—"
          ),
      }),
      /**
       * WHERE the money came from, not what kind of record this is — the two
       * are separate columns on purpose (#1614). A `mixed` payout keeps a null
       * source by design, so it shows its type and no link rather than being
       * made to point at one of the several things it covered.
       */
      columnHelper.accessor("source_type", {
        header: "Source",
        cell: ({ row }) => {
          const { source_type, source_id, source } = row.original
          if (!source_type) return "—"

          const kind =
            source_type === "design"
              ? "design"
              : source_type === "run"
                ? "run"
                : source_type === "inventory_order"
                  ? "inventory_order"
                  : null

          return (
            <div className="flex items-center gap-x-2">
              <Badge color="grey">{source_type.replace("_", " ")}</Badge>
              {kind && source_id ? (
                <RefLink
                  kind={kind}
                  refOrId={source || source_id}
                  className="text-ui-fg-interactive text-xs hover:underline"
                />
              ) : null}
            </div>
          )
        },
      }),
      columnHelper.accessor("created_at", {
        header: "Created",
        cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
      }),
    ],
    []
  )

  const table = useDataTable({
    columns,
    data: reconciliations ?? [],
    getRowId: (row) => row.id,
    onRowClick: (_, row) =>
      navigate(`/payment-submissions/reconciliation/${row.id}`),
    rowCount: count ?? 0,
    isLoading,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: setSearch },
  })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-4 py-3">
          <DataTable.Search placeholder="Search reconciliations..." />
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}
