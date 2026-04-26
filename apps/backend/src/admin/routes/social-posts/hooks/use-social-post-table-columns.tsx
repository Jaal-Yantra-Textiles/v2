import { Badge, createDataTableColumnHelper } from "@medusajs/ui"
import { AdminSocialPost } from "../../../hooks/api/social-posts"

const columnHelper = createDataTableColumnHelper<AdminSocialPost>()

export const useSocialPostTableColumns = () => {
  return [
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => info.getValue(),
      enableSorting: true,
      sortLabel: "Name",
      sortAscLabel: "A → Z",
      sortDescLabel: "Z → A",
    }),
    columnHelper.accessor("caption", {
      header: "Caption",
      cell: (info) => {
        const val = info.getValue() || "-"
        return val.length > 60 ? val.slice(0, 60) + "…" : val
      },
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => {
        const status = info.getValue()
        const color =
          status === "posted"
            ? "green"
            : status === "failed"
            ? "red"
            : status === "scheduled"
            ? "orange"
            : "grey"
        return <Badge color={color}>{status}</Badge>
      },
    }),
  ]
}
