import { Checkbox } from "@medusajs/ui"
import { createColumnHelper } from "@tanstack/react-table"
import { useMemo } from "react"
import { AdminPartner } from "../../../../hooks/api/partners"

const columnHelper = createColumnHelper<AdminPartner>()

export const usePartnerColumns = (
  selectedRows: Record<string, boolean>,
  handleRowSelect: (id: string) => void
) => {
  return useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: ({ table }) => {
          return (
            <Checkbox
              checked={
                table.getIsSomePageRowsSelected()
                  ? "indeterminate"
                  : table.getIsAllPageRowsSelected()
              }
              onCheckedChange={(value) => {
                if (value === "indeterminate") {
                  return
                }
                
                if (value) {
                  table.getRowModel().rows.forEach((row) => {
                    if (!selectedRows[row.id]) {
                      handleRowSelect(row.id)
                    }
                  })
                } else {
                  // Clear all selections by toggling selected ones
                  Object.keys(selectedRows).forEach((id) => {
                    if (selectedRows[id]) {
                      handleRowSelect(id)
                    }
                  })
                }
              }}
            />
          )
        },
        cell: ({ row }) => {
          const isSelected = selectedRows[row.id] || false
          
          return (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => {
                handleRowSelect(row.id)
              }}
            />
          )
        },
      }),
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue }) => {
          const name = getValue()
          return (
            <div className="flex flex-col">
              <span className="font-medium">{name || "N/A"}</span>
            </div>
          )
        },
      }),
      columnHelper.accessor("handle", {
        header: "Handle",
        cell: ({ getValue }) => {
          const handle = getValue()
          return (
            <span className="text-ui-fg-subtle text-sm">@{handle}</span>
          )
        },
      }),
      columnHelper.accessor("is_verified", {
        header: "Verified",
        cell: ({ getValue }) => {
          const isVerified = getValue()
          return (
            <div className="flex items-center gap-x-2">
              <div
                className={`h-2 w-2 rounded-full ${
                  isVerified ? "bg-ui-tag-green-bg" : "bg-ui-tag-red-bg"
                }`}
              />
              <span className="text-ui-fg-subtle text-xs">
                {isVerified ? "Verified" : "Not Verified"}
              </span>
            </div>
          )
        },
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => {
          const status = getValue()
          return (
            <span
              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                status === "active"
                  ? "bg-green-100 text-green-800"
                  : status === "inactive"
                  ? "bg-red-100 text-red-800"
                  : "bg-yellow-100 text-yellow-800"
              }`}
            >
              {status || "pending"}
            </span>
          )
        },
      }),
      columnHelper.accessor("created_at", {
        header: "Created",
        cell: ({ getValue }) => {
          const date = getValue()
          return new Date(date).toLocaleDateString()
        },
      }),
    ],
    [selectedRows, handleRowSelect]
  )
}
