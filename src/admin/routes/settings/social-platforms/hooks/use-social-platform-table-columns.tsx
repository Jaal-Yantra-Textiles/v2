import { createColumnHelper, CellContext } from "@tanstack/react-table"
import { useMemo } from "react"
import { AdminSocialPlatform } from "../../../../hooks/api/social-platforms"
import { PlatformActions } from "./platform-actions"

const columnHelper = createColumnHelper<AdminSocialPlatform>()

export const useSocialPlatformTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("url", {
        header: "URL",
        cell: (info) => {
          const url = info.getValue()
          return url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          ) : (
            "-"
          )
        },
      }),
      columnHelper.accessor("created_at", {
        header: "Created At",
        cell: (info) => new Date(info.getValue()).toLocaleDateString(),
      }),
      columnHelper.display({
        id: "actions",
        cell: ({ row }: CellContext<AdminSocialPlatform, unknown>) => (
          <PlatformActions platform={row.original} />
        ),
      }),
    ],
    []
  )
}
