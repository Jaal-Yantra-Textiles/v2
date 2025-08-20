"use client"

import { DataTable, StatusBadge, Text, useDataTable, DataTablePaginationState } from "@medusajs/ui"
import { ColumnDef } from "@tanstack/react-table"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

export type PartnerDesignRow = {
  id: string
  name?: string
  status: string
  priority?: string
  partner_info?: {
    partner_status?: "assigned" | "in_progress" | "finished" | "completed" | string
    partner_phase?: string | null
  }
}

const statusColor = (status: string): "green" | "orange" | "blue" => {
  if (status === "completed" || status === "Approved") return "green"
  if (status === "in_progress" || status === "In_Development" || status === "Revision" || status === "finished") return "orange"
  return "blue"
}

const buildColumns = (): ColumnDef<PartnerDesignRow>[] => [
  {
    id: "design",
    header: "Design",
    accessorKey: "name",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Text weight="plus">{row.original.name || row.original.id}</Text>
        <Text size="xsmall" className="text-ui-fg-subtle">{row.original.id}</Text>
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
    id: "partner_status",
    header: "Partner Status",
    accessorFn: (row) => row.partner_info?.partner_status || "assigned",
    cell: ({ row }) => (
      <StatusBadge color={statusColor(row.original.partner_info?.partner_status || "assigned")}>
        {row.original.partner_info?.partner_status || "assigned"}
      </StatusBadge>
    ),
  },
  {
    id: "partner_phase",
    header: "Partner Phase",
    accessorFn: (row) => row.partner_info?.partner_phase || "-",
  },
]

export default function DesignsTable({ data, count }: { data: PartnerDesignRow[]; count: number }) {
  const columns = useMemo(() => buildColumns(), [])
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: 20 })
  const router = useRouter()

  const table = useDataTable<PartnerDesignRow>({
    columns,
    data,
    getRowId: (row) => row.id,
    rowCount: count,
    onRowClick: (_, row) => router.push(`/dashboard/designs/${row.id}`),
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
