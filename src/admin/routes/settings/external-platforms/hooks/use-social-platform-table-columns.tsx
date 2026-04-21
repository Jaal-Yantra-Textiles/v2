import { createColumnHelper, CellContext } from "@tanstack/react-table"
import { useMemo } from "react"
import { AdminSocialPlatform } from "../../../../hooks/api/social-platforms"
import { PlatformActions } from "./platform-actions"
import { GOOGLE_MERCHANT_VIRTUAL_ID } from "../constants"

const columnHelper = createColumnHelper<AdminSocialPlatform>()

export const useSocialPlatformTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("base_url", {
        header: "URL",
        cell: (info) => {
          const url = info.getValue()
          return url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
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
        cell: ({ row }: CellContext<AdminSocialPlatform, unknown>) => {
          if (row.original.id === GOOGLE_MERCHANT_VIRTUAL_ID) return null
          return <PlatformActions platform={row.original} />
        },
      }),
    ],
    []
  )
}
