import { createColumnHelper } from "@tanstack/react-table"
import { AdminFormResponse } from "../api/forms"

const columnHelper = createColumnHelper<AdminFormResponse>()

export const useFormResponsesTableColumns = () => {
  return [
    columnHelper.accessor("email", {
      header: "Email",
      cell: ({ getValue }) => getValue() || "-",
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: ({ getValue }) => getValue() || "-",
    }),
    columnHelper.accessor("submitted_at", {
      header: "Submitted",
      cell: ({ getValue }) => {
        const val = getValue() as any
        if (!val) {
          return "-"
        }
        const d = new Date(val)
        return isNaN(d.getTime()) ? String(val) : d.toLocaleString()
      },
    }),
  ]
}
