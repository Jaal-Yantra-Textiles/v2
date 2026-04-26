import { createColumnHelper } from "@tanstack/react-table"
import { useMemo } from "react"
import type { AdminPaymentReport } from "../api/payment-reports"

const columnHelper = createColumnHelper<AdminPaymentReport>()

export const usePaymentReportTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue }) => String(getValue() ?? "-"),
      }),
      columnHelper.accessor("entity_type", {
        header: "Entity Type",
        cell: ({ getValue }) => String(getValue() ?? "-"),
      }),
      columnHelper.accessor("period_start", {
        header: "Period",
        cell: ({ row }) => {
          const start = row.original.period_start
            ? new Date(row.original.period_start).toLocaleDateString()
            : "-"
          const end = row.original.period_end
            ? new Date(row.original.period_end).toLocaleDateString()
            : "-"
          return `${start} → ${end}`
        },
      }),
      columnHelper.accessor("total_amount", {
        header: "Total Amount",
        cell: ({ getValue }) => `₹${Number(getValue() ?? 0).toLocaleString()}`,
      }),
      columnHelper.accessor("payment_count", {
        header: "Payment Count",
        cell: ({ getValue }) => String(getValue() ?? 0),
      }),
      columnHelper.accessor("generated_at", {
        header: "Generated At",
        cell: ({ getValue }) => {
          const v = getValue()
          return v ? new Date(v).toLocaleString() : "-"
        },
      }),
    ],
    [],
  )
}
