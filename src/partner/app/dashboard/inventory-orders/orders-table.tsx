"use client"

import { DataTable, StatusBadge, Text, useDataTable, DataTablePaginationState } from "@medusajs/ui"
import { ColumnDef } from "@tanstack/react-table"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

export type PartnerOrderRow = {
  id: string
  status: string
  quantity: number
  expected_delivery_date?: string | null
  partner_info?: {
    partner_status?: "assigned" | "in_progress" | "completed" | string
  }
  stock_location?: string
}

const statusColor = (status: string): "green" | "orange" | "blue" => {
  if (status === "Shipped" || status === "completed") return "green"
  if (status === "Processing" || status === "in_progress") return "orange"
  return "blue"
}

const formatDateUTC = (iso?: string | null) => {
  if (!iso) return "-"
  try {
    const d = new Date(iso)
    // yyyy-MM-dd
    return d.toISOString().slice(0, 10)
  } catch {
    return "-"
  }
}

const buildColumns = (): ColumnDef<PartnerOrderRow>[] => [
  {
    id: "id",
    header: "Order",
    accessorKey: "id",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Text weight="plus">{row.original.id}</Text>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {row.original.stock_location || "Unknown"}
        </Text>
      </div>
    ),
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    cell: ({ row }) => (
      <StatusBadge color={statusColor(row.original.status)}>
        {row.original.status}
      </StatusBadge>
    ),
  },
  {
    id: "quantity",
    header: "Qty",
    accessorKey: "quantity",
  },
  {
    id: "expected",
    header: "Expected",
    accessorFn: (row) => row.expected_delivery_date || "",
    cell: ({ row }) => <span>{formatDateUTC(row.original.expected_delivery_date)}</span>,
  },
  {
    id: "partner_status",
    header: "Partner Status",
    accessorFn: (row) => row.partner_info?.partner_status || "assigned",
    cell: ({ row }) => (
      <StatusBadge color={statusColor(row.original.partner_info?.partner_status || "assigned")}>
        {row.original.partner_info?.partner_status || "assigned"}
      </StatusBadge>
    ),
  },
]

export default function OrdersTable({ data, count }: { data: PartnerOrderRow[]; count: number }) {
  const columns = useMemo(() => buildColumns(), [])
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: 20 })
  const router = useRouter()

  const table = useDataTable<PartnerOrderRow>({
    columns,
    data,
    getRowId: (row) => row.id,
    rowCount: count,
    onRowClick: (_, row) => router.push(`/dashboard/inventory-orders/${row.id}`),
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
  })

  return (
    <DataTable instance={table}>
      <DataTable.Table />
      <DataTable.Pagination />
    </DataTable>
  )
}
