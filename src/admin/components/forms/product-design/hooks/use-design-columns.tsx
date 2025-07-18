import { createColumnHelper } from "@tanstack/react-table"
import { Badge, StatusBadge, Checkbox } from "@medusajs/ui"
import type { AdminDesign } from "../../../../hooks/api/designs"

const columnHelper = createColumnHelper<AdminDesign>()

export const useDesignColumns = (
  selectedRows: Record<string, boolean>,
  handleRowSelect: (id: string) => void,
  linkedDesignIds: Set<string>
) => {
  return [
    columnHelper.display({
      id: "select",
      header: ({ table }) => {
        const allRowsSelected = table.getIsAllPageRowsSelected()
        const someRowsSelected = table.getIsSomePageRowsSelected()
        
        return (
          <Checkbox
            checked={allRowsSelected || (someRowsSelected ? "indeterminate" : false)}
            onCheckedChange={(value) => {
              if (value) {
                // Select all available (non-linked) rows
                table.getRowModel().rows.forEach(row => {
                  if (!linkedDesignIds.has(row.original.id)) {
                    handleRowSelect(row.original.id)
                  }
                })
              } else {
                // Deselect all rows
                table.getRowModel().rows.forEach(row => {
                  if (selectedRows[row.original.id]) {
                    handleRowSelect(row.original.id)
                  }
                })
              }
            }}
            aria-label="Select all"
          />
        )
      },
      cell: ({ row }) => {
        const isLinked = linkedDesignIds.has(row.original.id)
        const isSelected = selectedRows[row.original.id] || false
        
        return (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => handleRowSelect(row.original.id)}
            aria-label="Select row"
            disabled={isLinked}
            className={isLinked ? "opacity-50" : ""}
          />
        )
      },
      enableSorting: false,
      enableHiding: false,
    }),
    columnHelper.accessor("name", {
      header: "Name",
      cell: ({ getValue }) => (
        <div className="font-medium">{getValue()}</div>
      ),
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: ({ getValue }) => {
        const status = getValue()
        if (!status) return null
        
        const getStatusColor = (status: string) => {
          switch (status) {
            case "Conceptual":
              return "grey"
            case "In_Development":
              return "orange"
            case "Technical_Review":
              return "blue"
            case "Commerce_Ready":
              return "green"
            default:
              return "grey"
          }
        }

        return (
          <StatusBadge color={getStatusColor(status)}>
            {status.replace(/_/g, " ")}
          </StatusBadge>
        )
      },
    }),
    columnHelper.accessor("design_type", {
      header: "Type",
      cell: ({ getValue }) => {
        const type = getValue()
        return type ? <Badge>{type}</Badge> : null
      },
    }),
    columnHelper.accessor("priority", {
      header: "Priority",
      cell: ({ getValue }) => {
        const priority = getValue()
        if (!priority) return null
        
        const getPriorityColor = (priority: string) => {
          switch (priority) {
            case "High":
              return "red"
            case "Medium":
              return "orange"
            case "Low":
              return "green"
            default:
              return "grey"
          }
        }

        return (
          <Badge color={getPriorityColor(priority)}>
            {priority}
          </Badge>
        )
      },
    }),
  ]
}
