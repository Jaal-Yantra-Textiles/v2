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
  type AdsAd,
  type AdsPlatformKind,
  useAdsAdGroups,
  useAdsList,
} from "../../../hooks/api/ads"
import {
  formatMicros,
  formatNumber,
  formatPercent,
  statusToTone,
} from "./format"

const PAGE_SIZE = 20
const columnHelper = createColumnHelper<AdsAd>()

type Props = { platformId: string; kind: AdsPlatformKind | null }

export const AdsTab = ({ platformId, kind }: Props) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const pageFromUrl = parseInt(searchParams.get("a_page") || "1", 10)
  const adGroupFilter = searchParams.get("ad_group_id") || undefined

  const pagination: DataTablePaginationState = {
    pageIndex: Math.max(0, pageFromUrl - 1),
    pageSize: PAGE_SIZE,
  }
  const offset = pagination.pageIndex * pagination.pageSize

  const { data: adGroupsData } = useAdsAdGroups({
    platform_id: platformId,
    limit: 200,
  })

  const { data, isLoading, isError, error } = useAdsList({
    platform_id: platformId,
    ad_group_id: adGroupFilter,
    limit: pagination.pageSize,
    offset,
  })

  const handlePaginationChange = useCallback(
    (newPagination: DataTablePaginationState) => {
      const params = new URLSearchParams(searchParams)
      if (newPagination.pageIndex > 0)
        params.set("a_page", String(newPagination.pageIndex + 1))
      else params.delete("a_page")
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  const setAdGroupFilter = (next: string) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set("ad_group_id", next)
    else params.delete("ad_group_id")
    params.delete("a_page")
    setSearchParams(params, { replace: true })
  }

  const adGroups = adGroupsData?.ad_groups || []

  const columns = [
    columnHelper.display({
      id: "preview",
      header: "Creative",
      cell: ({ row }) => <AdPreview ad={row.original} />,
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
    data: data?.ads || [],
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
          Filter by {kind === "google" ? "ad group" : "ad set"}:
        </Text>
        <Select
          size="small"
          value={adGroupFilter || "all"}
          onValueChange={(v) => setAdGroupFilter(v === "all" ? "" : v)}
        >
          <Select.Trigger className="w-[280px]">
            <Select.Value placeholder={`All ${kind === "google" ? "ad groups" : "ad sets"}`} />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">
              All {kind === "google" ? "ad groups" : "ad sets"}
            </Select.Item>
            {adGroups.map((ag) => (
              <Select.Item key={ag.id} value={ag.id}>
                {ag.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 w-full px-6 py-4">
          <div>
            <Heading>Ads</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Individual creatives. Headlines + final URLs are shown inline;
              full bodies live under `raw` for now.
            </Text>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

// Inline preview that picks whichever shape the ad happens to have. Falls
// back to the bare ad ID so an unrenderable creative still has SOMETHING
// to click on.
const AdPreview = ({ ad }: { ad: AdsAd }) => {
  const firstHeadline = ad.headlines?.[0]?.text
  const firstUrl = ad.final_urls?.[0]
  const label = ad.name || firstHeadline || firstUrl || ad.provider_ad_id

  return (
    <div className="flex items-center gap-3 max-w-[400px]">
      {ad.image_url ? (
        <img
          src={ad.image_url}
          alt=""
          className="w-10 h-10 rounded-md object-cover border border-ui-border-base"
          loading="lazy"
        />
      ) : (
        <div className="w-10 h-10 rounded-md border border-ui-border-base bg-ui-bg-subtle flex items-center justify-center text-[10px] text-ui-fg-muted uppercase">
          {ad.type?.split("_")[0]?.slice(0, 4) || "ad"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <Text size="small" className="font-medium truncate">
          {label}
        </Text>
        {firstUrl && (
          <Text size="xsmall" className="text-ui-fg-subtle truncate">
            {firstUrl}
          </Text>
        )}
      </div>
    </div>
  )
}
