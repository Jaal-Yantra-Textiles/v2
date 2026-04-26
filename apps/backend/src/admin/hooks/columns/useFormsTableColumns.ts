import { createDataTableColumnHelper } from "@medusajs/ui"
import { AdminForm } from "../api/forms"

const columnHelper = createDataTableColumnHelper<AdminForm>()

export const useFormsTableColumns = () => {
  return [
    columnHelper.accessor("title", {
      header: "Title",
      cell: ({ getValue }) => getValue() || "-",
      enableSorting: true,
      sortLabel: "Title",
      sortAscLabel: "A → Z",
      sortDescLabel: "Z → A",
    }),
    columnHelper.accessor("handle", {
      header: "Handle",
      cell: ({ getValue }) => getValue() || "-",
      enableSorting: true,
      sortLabel: "Handle",
      sortAscLabel: "A → Z",
      sortDescLabel: "Z → A",
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
