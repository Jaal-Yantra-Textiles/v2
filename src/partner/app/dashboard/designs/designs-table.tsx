"use client"

import { DataTable, StatusBadge, Text, useDataTable, DataTablePaginationState } from "@medusajs/ui"
import { ColumnDef } from "@tanstack/react-table"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

export type PartnerDesignRow = {
  id: string
  design_id: string
  partner_id: string
  design: {
    id: string
    name?: string
    status: string
    priority?: string
  }
  partner: {
    id: string
    name?: string
    handle?: string
  }
  assignment: {
    status: "incoming" | "assigned" | "in_progress" | "finished" | "completed" | string
    phase?: string | null
    started_at?: string | null
    finished_at?: string | null
    completed_at?: string | null
    workflow_tasks_count?: number
  }
}

const statusColor = (status: string): "green" | "orange" | "blue" => {
  if (status === "completed" || status === "Approved") return "green"
  if (status === "in_progress" || status === "In_Development" || status === "Revision" || status === "finished") return "orange"
  return "blue"
}

const buildColumns = (): ColumnDef<PartnerDesignRow>[] => [
  {
    id: "id",
    header: "Design",
    accessorFn: (row) => row.design?.name || row.design_id,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Text weight="plus">{row.original.design?.name || row.original.design_id}</Text>
        <Text size="xsmall" className="text-ui-fg-subtle">{row.original.design_id}</Text>
      </div>
    ),
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (row) => row.design?.status,
    cell: ({ row }) => (
      <StatusBadge color={statusColor(row.original.design?.status || "")}> 
        {row.original.design?.status}
      </StatusBadge>
    ),
  },
  {
    id: "partner_status",
    header: "Partner Status",
    accessorFn: (row) => row.assignment?.status || "incoming",
    cell: ({ row }) => (
      <StatusBadge color={statusColor(row.original.assignment?.status || "incoming")}>
        {row.original.assignment?.status || "incoming"}
      </StatusBadge>
    ),
  },
  {
    id: "partner_phase",
    header: "Partner Phase",
    accessorFn: (row) => row.assignment?.phase || "-",
  },
]

export default function DesignsTable({ data, count }: { data: PartnerDesignRow[]; count: number }) {
  const columns = useMemo(() => buildColumns(), [])
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: 20 })
  const router = useRouter()

  const handleRowClick = (row: PartnerDesignRow) => {
    router.push(`/dashboard/designs/${row.id}`)
  }

  const table = useDataTable<PartnerDesignRow>({
    columns,
    data,
    getRowId: (row) => row.design_id,
    rowCount: count,
    onRowClick: (_, row: PartnerDesignRow) => { handleRowClick(row) },
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
