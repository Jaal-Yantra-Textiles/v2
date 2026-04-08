import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Container, Badge, DataTable, useDataTable } from "@medusajs/ui"
import { createColumnHelper } from "@tanstack/react-table"
import { keepPreviousData } from "@tanstack/react-query"
import {
  useReconciliations,
  type PaymentReconciliation,
} from "../../../hooks/api/payment-submissions"

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
          <Badge color={statusColor(getValue())}>{getValue()}</Badge>
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
      columnHelper.accessor("partner_id", {
        header: "Partner",
        cell: ({ getValue }) =>
          getValue() ? (
            <span className="font-mono text-xs">{getValue()!.slice(0, 12)}...</span>
          ) : (
            "—"
          ),
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
