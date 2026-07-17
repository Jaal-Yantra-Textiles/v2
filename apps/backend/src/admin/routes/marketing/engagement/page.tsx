import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  DataTable,
  type DataTablePaginationState,
  Heading,
  Input,
  StatusBadge,
  Text,
  clx,
  useDataTable,
} from "@medusajs/ui"
import { createColumnHelper } from "@tanstack/react-table"
import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { sdk } from "../../../lib/config"

const PAGE_SIZE = 20

type EngagementStatus =
  | "engaged"
  | "cooling"
  | "dormant"
  | "never_opened"
  | "unknown"

type EmailEngagement = {
  id: string
  email: string
  delivered_count: number
  opens_count: number
  clicks_count: number
  delivered_since_last_open: number
  first_delivered_at: string | null
  last_delivered_at: string | null
  last_open_at: string | null
  last_click_at: string | null
  last_event_at: string | null
  engagement_status: EngagementStatus
  status_computed_at: string | null
}

type EngagementResponse = {
  engagement: EmailEngagement[]
  count: number
  offset: number
  limit: number
  summary: Record<EngagementStatus | "total", number>
}

const columnHelper = createColumnHelper<EmailEngagement>()

const statusToTone = (
  status: EngagementStatus
): "green" | "orange" | "red" | "grey" => {
  switch (status) {
    case "engaged":
      return "green"
    case "cooling":
      return "orange"
    case "dormant":
      return "red"
    default:
      return "grey"
  }
}

const STATUS_LABEL: Record<EngagementStatus, string> = {
  engaged: "Engaged",
  cooling: "Cooling",
  dormant: "Dormant",
  never_opened: "Never opened",
  unknown: "Unknown",
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "engaged", label: "Engaged" },
  { value: "cooling", label: "Cooling" },
  { value: "dormant", label: "Dormant" },
  { value: "never_opened", label: "Never opened" },
  { value: "unknown", label: "Unknown" },
] as const

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

const EngagementView = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const pageFromUrl = parseInt(searchParams.get("e_page") || "1", 10)
  const statusParam = searchParams.get("e_status") || "all"
  const status = FILTERS.some((f) => f.value === statusParam)
    ? statusParam
    : "all"
  const qParam = searchParams.get("e_q") || ""

  // Local search box, debounced into the URL so typing doesn't refetch per key.
  const [search, setSearch] = useState(qParam)
  useEffect(() => setSearch(qParam), [qParam])
  useEffect(() => {
    const handle = setTimeout(() => {
      if (search === qParam) return
      const params = new URLSearchParams(searchParams)
      if (search.trim()) params.set("e_q", search.trim())
      else params.delete("e_q")
      params.delete("e_page")
      setSearchParams(params, { replace: true })
    }, 350)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const pagination: DataTablePaginationState = {
    pageIndex: Math.max(0, pageFromUrl - 1),
    pageSize: PAGE_SIZE,
  }
  const offset = pagination.pageIndex * pagination.pageSize

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["marketing", "engagement", status, qParam, pagination],
    queryFn: async () => {
      return await sdk.client.fetch<EngagementResponse>(
        "/admin/marketing/engagement",
        {
          query: {
            ...(status !== "all" ? { status } : {}),
            ...(qParam ? { q: qParam } : {}),
            limit: pagination.pageSize,
            offset,
          },
        }
      )
    },
    placeholderData: (prev) => prev,
  })

  const handleStatusChange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams)
      if (next !== "all") params.set("e_status", next)
      else params.delete("e_status")
      params.delete("e_page")
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  const handlePaginationChange = useCallback(
    (newPagination: DataTablePaginationState) => {
      const params = new URLSearchParams(searchParams)
      if (newPagination.pageIndex > 0)
        params.set("e_page", String(newPagination.pageIndex + 1))
      else params.delete("e_page")
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  const columns = [
    columnHelper.accessor("email", {
      header: "Email",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("engagement_status", {
      header: "Status",
      cell: (info) => (
        <StatusBadge color={statusToTone(info.getValue())}>
          {STATUS_LABEL[info.getValue()] ?? info.getValue()}
        </StatusBadge>
      ),
    }),
    columnHelper.accessor("delivered_count", {
      header: "Delivered",
      cell: (info) => info.getValue() ?? 0,
    }),
    columnHelper.accessor("opens_count", {
      header: "Opens",
      cell: (info) => info.getValue() ?? 0,
    }),
    columnHelper.accessor("clicks_count", {
      header: "Clicks",
      cell: (info) => info.getValue() ?? 0,
    }),
    columnHelper.accessor("delivered_since_last_open", {
      header: "Cold streak",
      cell: (info) => info.getValue() ?? 0,
    }),
    columnHelper.accessor("last_open_at", {
      header: "Last open",
      cell: (info) => formatDateTime(info.getValue()),
    }),
    columnHelper.accessor("last_event_at", {
      header: "Last event",
      cell: (info) => formatDateTime(info.getValue()),
    }),
  ]

  const table = useDataTable({
    data: data?.engagement || [],
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

  const summary = data?.summary

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-4 px-6 py-4">
        <div>
          <Heading>Engagement</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Per-recipient email engagement — deliveries, opens and clicks folded
            into a status the bulk-send gate uses to soft-exclude dormant
            contacts.
          </Text>
        </div>
        {summary && (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                ["total", "Total"],
                ["engaged", "Engaged"],
                ["cooling", "Cooling"],
                ["dormant", "Dormant"],
                ["never_opened", "Never opened"],
                ["unknown", "Unknown"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex flex-col">
                <Text size="xsmall" className="text-ui-fg-muted">
                  {label}
                </Text>
                <Text size="large" weight="plus" className="tabular-nums">
                  {summary[key] ?? 0}
                </Text>
              </div>
            ))}
          </div>
        )}
      </div>

      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row md:items-center justify-between gap-y-4 w-full px-6 py-4">
          <div className="flex items-center gap-x-1 rounded-lg bg-ui-bg-subtle p-1 overflow-x-auto">
            {FILTERS.map((f) => (
              <Button
                key={f.value}
                size="small"
                variant="transparent"
                onClick={() => handleStatusChange(f.value)}
                className={clx(
                  "whitespace-nowrap",
                  status === f.value && "bg-ui-bg-base shadow-borders-base"
                )}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <Input
            size="small"
            placeholder="Search email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="md:w-64"
          />
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Engagement",
})

export default EngagementView
