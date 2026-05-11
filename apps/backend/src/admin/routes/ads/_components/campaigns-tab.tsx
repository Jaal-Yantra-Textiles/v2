import {
  Container,
  DataTable,
  type DataTablePaginationState,
  Heading,
  Select,
  StatusBadge,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { createColumnHelper } from "@tanstack/react-table"
import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import {
  type AdsCampaign,
  type AdsPlatformKind,
  useAdsAccounts,
  useAdsCampaigns,
} from "../../../hooks/api/ads"
import {
  formatMicros,
  formatNumber,
  formatPercent,
  shortDate,
  statusToTone,
} from "./format"

const PAGE_SIZE = 20
const columnHelper = createColumnHelper<AdsCampaign>()

type Props = { platformId: string; kind: AdsPlatformKind | null }

export const CampaignsTab = ({ platformId, kind }: Props) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const pageFromUrl = parseInt(searchParams.get("cmp_page") || "1", 10)
  const accountFilter = searchParams.get("account_id") || undefined

  const pagination: DataTablePaginationState = {
    pageIndex: Math.max(0, pageFromUrl - 1),
    pageSize: PAGE_SIZE,
  }
  const offset = pagination.pageIndex * pagination.pageSize

  // Account picker for filtering — uses the same accounts endpoint as the
  // first tab so the dropdown shows whatever the operator just synced.
  const { data: accountsData } = useAdsAccounts({
    platform_id: platformId,
    limit: 200,
  })

  const { data, isLoading, isError, error } = useAdsCampaigns({
    platform_id: platformId,
    account_id: accountFilter,
    limit: pagination.pageSize,
    offset,
  })

  const handlePaginationChange = useCallback(
    (newPagination: DataTablePaginationState) => {
      const params = new URLSearchParams(searchParams)
      if (newPagination.pageIndex > 0)
        params.set("cmp_page", String(newPagination.pageIndex + 1))
      else params.delete("cmp_page")
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  const setAccountFilter = (next: string) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set("account_id", next)
    else params.delete("account_id")
    params.delete("cmp_page")
    setSearchParams(params, { replace: true })
  }

  const accounts = accountsData?.accounts || []
  const currency = useMemo(() => {
    if (!accountFilter) return accounts[0]?.currency || "USD"
    return accounts.find((a) => a.id === accountFilter)?.currency || "USD"
  }, [accounts, accountFilter])

  const columns = [
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => (
        <span className="font-medium">{info.getValue() || "—"}</span>
      ),
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => (
        <StatusBadge color={statusToTone(info.getValue())}>
          {info.getValue()}
        </StatusBadge>
      ),
    }),
    columnHelper.accessor("objective_or_channel_type", {
      header: kind === "google" ? "Channel" : "Objective",
      cell: (info) => info.getValue() || "—",
    }),
    columnHelper.accessor("impressions", {
      header: "Impressions",
      cell: (info) => formatNumber(info.getValue()),
    }),
    columnHelper.accessor("clicks", {
      header: "Clicks",
      cell: (info) => formatNumber(info.getValue()),
    }),
    columnHelper.display({
      id: "ctr",
      header: "CTR",
      cell: ({ row }) => {
        const { impressions, clicks } = row.original
        if (!impressions) return "—"
        return formatPercent((clicks / impressions) * 100)
      },
    }),
    columnHelper.accessor("cost_micros", {
      header: "Spend",
      cell: (info) => formatMicros(info.getValue(), currency),
    }),
    columnHelper.accessor("conversions", {
      header: "Conversions",
      cell: (info) => formatNumber(info.getValue()),
    }),
    columnHelper.display({
      id: "dates",
      header: "Window",
      cell: ({ row }) => {
        const { start_date, end_date } = row.original
        if (!start_date && !end_date) return "—"
        return `${shortDate(start_date)} → ${shortDate(end_date)}`
      },
    }),
  ]

  const table = useDataTable({
    data: data?.campaigns || [],
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
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">
          Filter by account:
        </Text>
        <Select
          size="small"
          value={accountFilter || "all"}
          onValueChange={(v) => setAccountFilter(v === "all" ? "" : v)}
        >
          <Select.Trigger className="w-[260px]">
            <Select.Value placeholder="All accounts" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">All accounts</Select.Item>
            {accounts.map((a) => (
              <Select.Item key={a.id} value={a.id}>
                {a.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 w-full px-6 py-4">
          <div>
            <Heading>Campaigns</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Rolled-up window metrics. Use the Insights tab for daily trend.
            </Text>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}
