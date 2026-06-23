import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Container,
  DataTable,
  type DataTablePaginationState,
  Heading,
  StatusBadge,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { createColumnHelper } from "@tanstack/react-table"
import { useQuery } from "@tanstack/react-query"
import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { sdk } from "../../../lib/config"

const PAGE_SIZE = 20

type MarketingOutreach = {
  id: string
  recipient_email: string
  recipient_name: string | null
  company: string | null
  status: "queued" | "sent" | "opened" | "replied" | "bounced" | "unknown"
  channel: "email" | "whatsapp" | "manual"
  campaign: string | null
  sent_at: string | null
  opened_at: string | null
  replied_at: string | null
  bounce_unreliable: boolean
  notes: string | null
  external_id: string | null
  created_at: string
  updated_at: string
}

const columnHelper = createColumnHelper<MarketingOutreach>()

const statusToTone = (
  status: MarketingOutreach["status"]
): "green" | "blue" | "orange" | "purple" | "grey" => {
  switch (status) {
    case "replied":
      return "green"
    case "opened":
      return "blue"
    case "sent":
      return "purple"
    case "queued":
      return "grey"
    case "bounced":
      return "orange"
    default:
      return "grey"
  }
}

const formatDateTime = (iso: string | null): string => {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return "—"
  }
}

const WinbacksView = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const pageFromUrl = parseInt(searchParams.get("w_page") || "1", 10)

  const pagination: DataTablePaginationState = {
    pageIndex: Math.max(0, pageFromUrl - 1),
    pageSize: PAGE_SIZE,
  }

  const offset = pagination.pageIndex * pagination.pageSize

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["marketing", "winbacks", pagination],
    queryFn: async () => {
      const res = await sdk.client.fetch<{
        outreach: MarketingOutreach[]
        count: number
        offset: number
        limit: number
      }>("/admin/marketing/outreach", {
        query: {
          campaign: "winback",
          limit: pagination.pageSize,
          offset,
        },
      })
      return res
    },
    placeholderData: (prev) => prev,
  })

  const handlePaginationChange = useCallback(
    (newPagination: DataTablePaginationState) => {
      const params = new URLSearchParams(searchParams)
      if (newPagination.pageIndex > 0)
        params.set("w_page", String(newPagination.pageIndex + 1))
      else params.delete("w_page")
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  const columns = [
    columnHelper.accessor("recipient_email", {
      header: "Email",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("recipient_name", {
      header: "Name",
      cell: (info) => info.getValue() || "—",
    }),
    columnHelper.accessor("company", {
      header: "Company",
      cell: (info) => info.getValue() || "—",
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => (
        <span className="flex items-center gap-2">
          <StatusBadge color={statusToTone(info.getValue())}>
            {info.getValue()}
          </StatusBadge>
          {info.row.original.bounce_unreliable && (
            <Badge color="orange" size="xsmall">
              Bounce unreliable
            </Badge>
          )}
        </span>
      ),
    }),
    columnHelper.accessor("channel", {
      header: "Channel",
      cell: (info) => info.getValue() || "—",
    }),
    columnHelper.accessor("campaign", {
      header: "Campaign",
      cell: (info) => info.getValue() || "—",
    }),
    columnHelper.accessor("sent_at", {
      header: "Sent",
      cell: (info) => formatDateTime(info.getValue()),
    }),
    columnHelper.accessor("opened_at", {
      header: "Opened",
      cell: (info) => formatDateTime(info.getValue()),
    }),
    columnHelper.accessor("replied_at", {
      header: "Replied",
      cell: (info) => formatDateTime(info.getValue()),
    }),
  ]

  const table = useDataTable({
    data: data?.outreach || [],
    columns,
    rowCount: data?.count || 0,
    getRowId: (row) => row.id,
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: handlePaginationChange,
    },
  })

  if (isError) throw error

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 w-full px-6 py-4">
          <div>
            <Heading>Winbacks</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Winback outreach to re-engage lapsed customers.
              <span className="ml-2">
                <Badge color="orange" size="xsmall">
                  Bounce unreliable
                </Badge>{" "}
                = provider bounce flags are unreliable — verify manually.
              </span>
            </Text>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Winbacks",
})

export default WinbacksView
