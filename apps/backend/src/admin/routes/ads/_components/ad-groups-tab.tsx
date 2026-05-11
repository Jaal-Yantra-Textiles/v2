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
import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import {
  type AdsAdGroup,
  type AdsPlatformKind,
  useAdsAdGroups,
  useAdsCampaigns,
} from "../../../hooks/api/ads"
import {
  formatMicros,
  formatNumber,
  formatPercent,
  statusToTone,
} from "./format"

const PAGE_SIZE = 20
const columnHelper = createColumnHelper<AdsAdGroup>()

type Props = { platformId: string; kind: AdsPlatformKind | null }

export const AdGroupsTab = ({ platformId, kind }: Props) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const pageFromUrl = parseInt(searchParams.get("ag_page") || "1", 10)
  const campaignFilter = searchParams.get("campaign_id") || undefined

  const pagination: DataTablePaginationState = {
    pageIndex: Math.max(0, pageFromUrl - 1),
    pageSize: PAGE_SIZE,
  }
  const offset = pagination.pageIndex * pagination.pageSize

  const { data: campaignsData } = useAdsCampaigns({
    platform_id: platformId,
    limit: 200,
  })

  const { data, isLoading, isError, error } = useAdsAdGroups({
    platform_id: platformId,
    campaign_id: campaignFilter,
    limit: pagination.pageSize,
    offset,
  })

  const handlePaginationChange = useCallback(
    (newPagination: DataTablePaginationState) => {
      const params = new URLSearchParams(searchParams)
      if (newPagination.pageIndex > 0)
        params.set("ag_page", String(newPagination.pageIndex + 1))
      else params.delete("ag_page")
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  const setCampaignFilter = (next: string) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set("campaign_id", next)
    else params.delete("campaign_id")
    params.delete("ag_page")
    setSearchParams(params, { replace: true })
  }

  const campaigns = campaignsData?.campaigns || []

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
    columnHelper.accessor("type", {
      header: "Type",
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
      cell: (info) => formatMicros(info.getValue()),
    }),
    columnHelper.accessor("conversions", {
      header: "Conversions",
      cell: (info) => formatNumber(info.getValue()),
    }),
  ]

  const table = useDataTable({
    data: data?.ad_groups || [],
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
          Filter by campaign:
        </Text>
        <Select
          size="small"
          value={campaignFilter || "all"}
          onValueChange={(v) => setCampaignFilter(v === "all" ? "" : v)}
        >
          <Select.Trigger className="w-[280px]">
            <Select.Value placeholder="All campaigns" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">All campaigns</Select.Item>
            {campaigns.map((c) => (
              <Select.Item key={c.id} value={c.id}>
                {c.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 w-full px-6 py-4">
          <div>
            <Heading>{kind === "google" ? "Ad groups" : "Ad sets"}</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              {kind === "google"
                ? "Google ad groups under the selected campaign(s)."
                : "Meta ad sets under the selected campaign(s)."}
            </Text>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}
