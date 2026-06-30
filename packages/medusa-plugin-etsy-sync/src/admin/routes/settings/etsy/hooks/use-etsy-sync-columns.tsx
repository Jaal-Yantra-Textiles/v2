import { createDataTableColumnHelper, StatusBadge } from "@medusajs/ui"

export type EtsySyncRecord = {
  id: string
  product_id: string
  account_id: string
  listing_id: string | null
  listing_url: string | null
  listing_state: string | null
  action: string
  status: string
  published: boolean
  error_message: string | null
  synced_at: string | null
  created_at: string
}

const columnHelper = createDataTableColumnHelper<EtsySyncRecord>()

export const useEtsySyncColumns = () => {
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
    columnHelper.accessor("listing_state", {
      header: "State",
      cell: (info) => info.getValue() || "—",
    }),
    columnHelper.display({
      id: "listing",
      header: "Listing",
      cell: ({ row }: any) => {
        const r = row.original as EtsySyncRecord
        if (!r.listing_url) return "—"
        return (
          <a
            href={r.listing_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
          >
            {r.listing_id}
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
