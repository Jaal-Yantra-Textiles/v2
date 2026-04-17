import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button, Container, Badge, DataTable, useDataTable } from "@medusajs/ui"
import { createColumnHelper } from "@tanstack/react-table"
import { keepPreviousData } from "@tanstack/react-query"
import {
  usePaymentSubmissions,
  type PaymentSubmission,
} from "../../../hooks/api/payment-submissions"

const columnHelper = createColumnHelper<PaymentSubmission>()

const statusColor = (
  status: string
): "green" | "orange" | "red" | "grey" | "blue" | "purple" => {
  switch (status) {
    case "Paid":
      return "green"
    case "Approved":
      return "blue"
    case "Pending":
    case "Under_Review":
      return "orange"
    case "Rejected":
      return "red"
    default:
      return "grey"
  }
}

export const SubmissionsTab = () => {
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
    payment_submissions,
    count,
    isPending: isLoading,
  } = usePaymentSubmissions(query, {
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
      columnHelper.accessor("partner_id", {
        header: "Partner",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue().slice(0, 12)}...</span>
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => (
          <Badge color={statusColor(getValue())}>{getValue().replace("_", " ")}</Badge>
        ),
      }),
      columnHelper.accessor("total_amount", {
        header: "Amount",
        cell: ({ getValue, row }) =>
          `${row.original.currency?.toUpperCase() || "INR"} ${Number(getValue()).toLocaleString()}`,
      }),
      columnHelper.accessor("items", {
        header: "Designs",
        cell: ({ getValue }) => (getValue() || []).length,
      }),
      columnHelper.accessor("submitted_at", {
        header: "Submitted",
        cell: ({ getValue }) =>
          getValue() ? new Date(getValue()!).toLocaleDateString() : "—",
      }),
      columnHelper.accessor("reviewed_at", {
        header: "Reviewed",
        cell: ({ getValue }) =>
          getValue() ? new Date(getValue()!).toLocaleDateString() : "—",
      }),
    ],
    []
  )

  const table = useDataTable({
    columns,
    data: payment_submissions ?? [],
    getRowId: (row) => row.id,
    onRowClick: (_, row) => navigate(`/payment-submissions/${row.id}`),
    rowCount: count ?? 0,
    isLoading,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: setSearch },
  })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-4 py-3">
          <DataTable.Search placeholder="Search submissions..." />
          <Button size="small" asChild>
            <Link to="create">New Submission</Link>
          </Button>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}
