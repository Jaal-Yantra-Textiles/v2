import { createDataTableColumnHelper } from "@medusajs/ui"
import { useMemo } from "react"
import type { AdminPartner } from "../api/partners-admin"

const columnHelper = createDataTableColumnHelper<AdminPartner>()

export const usePartnerTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue }) => String(getValue() ?? "-"),
        enableSorting: true,
        sortLabel: "Name",
        sortAscLabel: "A → Z",
        sortDescLabel: "Z → A",
      }),
      columnHelper.accessor("handle", {
        header: "Handle",
        cell: ({ getValue }) => String(getValue() ?? "-"),
        enableSorting: true,
        sortLabel: "Handle",
        sortAscLabel: "A → Z",
        sortDescLabel: "Z → A",
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => String(getValue() ?? "-"),
      }),
      columnHelper.accessor("is_verified", {
        header: "Verified",
        cell: ({ getValue }) => (getValue() ? "Yes" : "No"),
      }),
    ],
    [],
  )
}
