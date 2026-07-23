import { createDataTableColumnHelper, StatusBadge } from "@medusajs/ui"

export type BulkProduct = {
  id: string
  title: string
  status: string
  thumbnail: string | null
  handle: string | null
  created_at: string
  updated_at: string | null
}

const columnHelper = createDataTableColumnHelper<BulkProduct>()

export const useBulkProductColumns = () => {
  return [
    columnHelper.accessor("title", {
      header: "Product",
      cell: ({ row, getValue }) => {
        const p = row.original
        return (
          <div className="flex items-center gap-3">
            {p.thumbnail ? (
              <img
                src={p.thumbnail}
                alt=""
                className="h-8 w-8 rounded border border-ui-border-base object-cover"
              />
            ) : (
              <div className="h-8 w-8 rounded border border-ui-border-base bg-ui-bg-subtle" />
            )}
            <div className="flex flex-col">
              <span className="font-medium">{getValue()}</span>
              {p.handle && (
                <span className="text-ui-fg-subtle text-xs font-mono">
                  {p.handle}
                </span>
              )}
            </div>
          </div>
        )
      },
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => {
        const s = info.getValue()
        const color = s === "published" ? "green" : s === "draft" ? "orange" : "grey"
        return <StatusBadge color={color as any}>{s}</StatusBadge>
      },
    }),
    columnHelper.accessor("updated_at", {
      header: "Updated",
      cell: (info) => {
        const v = info.getValue()
        return v ? new Date(v).toLocaleString() : "—"
      },
    }),
  ]
}
