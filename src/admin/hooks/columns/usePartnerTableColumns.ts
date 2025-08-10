import { createColumnHelper } from "@tanstack/react-table"
import { useMemo } from "react"
import type { AdminPartner } from "../api/partners-admin"

const columnHelper = createColumnHelper<AdminPartner>()

export const usePartnerTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue }) => String(getValue() ?? "-"),
      }),
      columnHelper.accessor("handle", {
        header: "Handle",
        cell: ({ getValue }) => String(getValue() ?? "-"),
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
