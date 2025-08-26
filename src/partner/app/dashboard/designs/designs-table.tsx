"use client"

import { DataTable, StatusBadge, Text, useDataTable, DataTablePaginationState } from "@medusajs/ui"
import { ColumnDef } from "@tanstack/react-table"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

export type PartnerDesignRow = {
  // Support both legacy aggregated shape and direct design shape
  id?: string
  design_id?: string
  partner_id?: string
  name?: string
  status?: string
  partner_info?: {
    partner_status?: string
    partner_phase?: string | null
  }
  design?: {
    id: string
    name?: string
    status: string
    priority?: string
  }
  partner?: {
    id: string
    name?: string
    handle?: string
  }
  assignment?: {
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
    accessorFn: (row) => row.design?.name || row.name || row.design_id || row.id || "-",
    cell: ({ row }) => {
      const r = row.original
      const title = r.design?.name || r.name || r.design_id || r.id
      const sub = r.id || r.design?.id || r.design_id || "-"
      return (
        <div className="flex flex-col">
          <Text weight="plus">{title}</Text>
          <Text size="xsmall" className="text-ui-fg-subtle">{sub}</Text>
        </div>
      )
    },
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (row) => row.design?.status || row.status || "-",
    cell: ({ row }) => {
      const s = row.original.design?.status || row.original.status || "-"
      return (
        <StatusBadge color={statusColor(s)}> 
          {s}
        </StatusBadge>
      )
    },
  },
  {
    id: "partner_status",
    header: "Partner Status",
    accessorFn: (row) => row.assignment?.status || row.partner_info?.partner_status || "incoming",
    cell: ({ row }) => {
      const ps = row.original.assignment?.status || row.original.partner_info?.partner_status || "incoming"
      return (
        <StatusBadge color={statusColor(ps)}>
          {ps}
        </StatusBadge>
      )
    },
  },
  {
    id: "partner_phase",
    header: "Partner Phase",
    accessorFn: (row) => row.assignment?.phase || row.partner_info?.partner_phase || "-",
  },
]

export default function DesignsTable({ data, count }: { data: PartnerDesignRow[]; count: number }) {
  const columns = useMemo(() => buildColumns(), [])
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: 20 })
  const router = useRouter()
  const handleRowClick = (row: PartnerDesignRow) => {
    const id = row.id || row.design_id || row.design?.id
    if (id) router.push(`/dashboard/designs/${id}`)
  }

  const table = useDataTable<PartnerDesignRow>({
    columns,
    data,
    getRowId: (row) => row.id || row.design_id || row.design?.id || Math.random().toString(36).slice(2),
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
