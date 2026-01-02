import { createColumnHelper } from "@tanstack/react-table"
import { AdminForm } from "../api/forms"

const columnHelper = createColumnHelper<AdminForm>()

export const useFormsTableColumns = () => {
  return [
    columnHelper.accessor("title", {
      header: "Title",
      cell: ({ getValue }) => getValue() || "-",
    }),
    columnHelper.accessor("handle", {
      header: "Handle",
      cell: ({ getValue }) => getValue() || "-",
    }),
    columnHelper.accessor("domain", {
      header: "Domain",
      cell: ({ getValue }) => getValue() || "-",
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: ({ getValue }) => getValue() || "-",
    }),
  ]
}
