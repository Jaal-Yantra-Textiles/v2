import { createDataTableColumnHelper, StatusBadge } from "@medusajs/ui"

export type FaireSyncRecord = {
  id: string
  product_id: string
  account_id: string
  product_token: string | null
  product_url: string | null
  product_state: string | null
  action: string
  status: string
  published: boolean
  error_message: string | null
  synced_at: string | null
  created_at: string
}

const columnHelper = createDataTableColumnHelper<FaireSyncRecord>()

export const useFaireSyncColumns = () => {
  return [
    columnHelper.accessor("product_id", {
      header: "Product",
      cell: (info) => (
        <span className="font-mono text-ui-fg-subtle text-xs">
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => {
        const status = info.getValue()
        const color =
          status === "success"
            ? "green"
            : status === "failed"
              ? "red"
              : status === "draft"
                ? "orange"
                : "grey"
        return <StatusBadge color={color as any}>{status}</StatusBadge>
      },
    }),
    columnHelper.accessor("product_state", {
      header: "State",
      cell: (info) => info.getValue() || "—",
    }),
    columnHelper.display({
      id: "product",
      header: "Faire product",
      cell: ({ row }: any) => {
        const r = row.original as FaireSyncRecord
        if (!r.product_url) return "—"
        return (
          <a
            href={r.product_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
          >
            {r.product_token}
          </a>
        )
      },
    }),
    columnHelper.accessor("synced_at", {
      header: "Synced",
      cell: (info) => {
        const v = info.getValue()
        return v ? new Date(v).toLocaleString() : "—"
      },
      enableSorting: true,
      sortLabel: "Synced",
      sortAscLabel: "Oldest first",
      sortDescLabel: "Newest first",
    }),
  ]
}
