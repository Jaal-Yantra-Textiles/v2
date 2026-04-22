import { createColumnHelper, CellContext } from "@tanstack/react-table"
import { StatusBadge } from "@medusajs/ui"
import { PencilSquare, Trash } from "@medusajs/icons"
import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { AdminWebsite } from "../../../hooks/api/websites"
import { ActionMenu } from "../../../components/common/action-menu"

const columnHelper = createColumnHelper<AdminWebsite>()

const STATUS_COLOR: Record<string, "green" | "red" | "orange" | "blue" | "grey"> = {
  Active: "green",
  Inactive: "red",
  Maintenance: "orange",
  Development: "blue",
}

export const useWebsiteTableColumns = () => {
  const navigate = useNavigate()

  return useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: (info) => info.getValue() || "-",
      }),
      columnHelper.accessor("domain", {
        header: "Domain",
        cell: (info) => {
          const url = info.getValue()
          if (!url) return "-"
          return (
            <a
              href={`https://${url}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-ui-fg-interactive hover:underline"
            >
              {url}
            </a>
          )
        },
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => {
          const status = (info.getValue() as string) || "Unknown"
          return (
            <StatusBadge color={STATUS_COLOR[status] || "grey"}>
              {status}
            </StatusBadge>
          )
        },
      }),
      columnHelper.accessor("created_at", {
        header: "Created At",
        cell: (info) => {
          const v = info.getValue()
          return v ? new Date(v).toLocaleDateString() : "-"
        },
      }),
      columnHelper.display({
        id: "actions",
        cell: ({ row }: CellContext<AdminWebsite, unknown>) => (
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    icon: <PencilSquare />,
                    label: "Edit",
                    onClick: () =>
                      navigate(`/app/websites/${row.original.id}/edit`),
                  },
                  {
                    icon: <Trash />,
                    label: "Delete",
                    onClick: () =>
                      navigate(`/websites/${row.original.id}/delete`),
                  },
                ],
              },
            ]}
          />
        ),
      }),
    ],
    [navigate]
  )
}
