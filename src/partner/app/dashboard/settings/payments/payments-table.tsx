"use client"

import { useMemo, useState } from "react"
import { DataTable, DataTablePaginationState, Text, useDataTable } from "@medusajs/ui"
import { ColumnDef } from "@tanstack/react-table"
import { PartnerPayment } from "../../actions"

function formatCurrency(amount?: number, currency?: string) {
  if (typeof amount !== "number") return "—"
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: (currency || "USD").toUpperCase() }).format(amount)
  } catch {
    return `${amount} ${currency || ""}`.trim()
  }
}

function formatDate(iso?: string) {
  if (!iso) return "-"
  try {
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return "-"
  }
}

const buildColumns = (): ColumnDef<PartnerPayment>[] => [
  {
    id: "id",
    header: "Payment ID",
    accessorKey: "id",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Text weight="plus">{row.original.id}</Text>
        <Text size="xsmall" className="text-ui-fg-subtle">{formatDate(row.original.created_at)}</Text>
      </div>
    ),
  },
  {
    id: "amount",
    header: "Amount",
    accessorKey: "amount",
    cell: ({ row }) => formatCurrency(row.original.amount, row.original.currency_code),
  },
  {
    id: "currency",
    header: "Currency",
    accessorFn: (row) => row.currency_code || "",
    cell: ({ row }) => (row.original.currency_code || "").toUpperCase() || "—",
  },
]

export default function PaymentsTable({ data }: { data: PartnerPayment[] }) {
  const columns = useMemo(() => buildColumns(), [])
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: 20 })

  const table = useDataTable<PartnerPayment>({
    columns,
    data,
    getRowId: (row) => row.id,
    rowCount: data.length,
    pagination: { state: pagination, onPaginationChange: setPagination },
  })

  return (
    <DataTable instance={table}>
      <DataTable.Table />
      <DataTable.Pagination />
    </DataTable>
  )
}
