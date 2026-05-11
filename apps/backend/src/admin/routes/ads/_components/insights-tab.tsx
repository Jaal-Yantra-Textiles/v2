import {
  Container,
  DataTable,
  type DataTablePaginationState,
  Heading,
  Input,
  Select,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { createColumnHelper } from "@tanstack/react-table"
import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  type AdsInsight,
  type AdsInsightLevel,
  type AdsPlatformKind,
  useAdsAdGroups,
  useAdsCampaigns,
  useAdsInsights,
  useAdsList,
} from "../../../hooks/api/ads"
import { formatMicros, formatNumber } from "./format"

const PAGE_SIZE = 50
const columnHelper = createColumnHelper<AdsInsight>()

type Props = { platformId: string; kind: AdsPlatformKind | null }

const LEVELS_GOOGLE: { value: AdsInsightLevel; label: string }[] = [
  { value: "campaign", label: "Campaign" },
  { value: "ad_group", label: "Ad group" },
  { value: "ad", label: "Ad" },
  { value: "customer", label: "Account" },
]
const LEVELS_META: { value: AdsInsightLevel; label: string }[] = [
  { value: "campaign", label: "Campaign" },
  { value: "adset", label: "Ad set" },
  { value: "ad", label: "Ad" },
  { value: "account", label: "Account" },
]

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export const InsightsTab = ({ platformId, kind }: Props) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const levels = kind === "meta" ? LEVELS_META : LEVELS_GOOGLE

  const level =
    (searchParams.get("level") as AdsInsightLevel) || levels[0].value
  const entityId = searchParams.get("entity_id") || undefined
  const fromDate = searchParams.get("from") || daysAgo(30)
  const toDate = searchParams.get("to") || today()

  const pageFromUrl = parseInt(searchParams.get("ins_page") || "1", 10)
  const pagination: DataTablePaginationState = {
    pageIndex: Math.max(0, pageFromUrl - 1),
    pageSize: PAGE_SIZE,
  }

  // Entity picker dataset depends on level. We load whichever list the
  // current level needs and let the user pick a specific entity.
  const { data: campaignsData } = useAdsCampaigns({
    platform_id: platformId,
    limit: 200,
  })
  const { data: adGroupsData } = useAdsAdGroups({
    platform_id: platformId,
    limit: 200,
  })
  const { data: adsData } = useAdsList({
    platform_id: platformId,
    limit: 200,
  })

  const entityOptions = useMemo(() => {
    if (level === "campaign")
      return (campaignsData?.campaigns || []).map((c) => ({
        id: c.id,
        label: c.name,
      }))
    if (level === "ad_group" || level === "adset")
      return (adGroupsData?.ad_groups || []).map((a) => ({
        id: a.id,
        label: a.name,
      }))
    if (level === "ad")
      return (adsData?.ads || []).map((a) => ({
        id: a.id,
        label: a.name || a.provider_ad_id,
      }))
    return []
  }, [level, campaignsData, adGroupsData, adsData])

  const { data, isLoading, isError, error } = useAdsInsights({
    platform_id: platformId,
    level,
    entity_id: entityId,
    from: fromDate,
    to: toDate,
    limit: 1000,
  })

  const insights = data?.insights || []

  const updateParam = useCallback(
    (key: string, value: string | undefined) => {
      const next = new URLSearchParams(searchParams)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== "ins_page") next.delete("ins_page")
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  // Time-series chart aggregates daily sums across whatever rows we got.
  // If the operator picked a specific entity, this is that entity's trend;
  // otherwise it's the whole level's trend across the date window.
  const chartData = useMemo(() => {
    const byDate = new Map<
      string,
      { date: string; impressions: number; clicks: number; spend: number }
    >()
    for (const row of insights) {
      if (!row.date) continue
      const existing = byDate.get(row.date) || {
        date: row.date,
        impressions: 0,
        clicks: 0,
        spend: 0,
      }
      existing.impressions += row.impressions || 0
      existing.clicks += row.clicks || 0
      existing.spend += (row.cost_micros || 0) / 1_000_000
      byDate.set(row.date, existing)
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [insights])

  const currency = insights[0]?.currency_code || "USD"

  const columns = [
    columnHelper.accessor("date", {
      header: "Date",
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
    columnHelper.accessor("ctr", {
      header: "CTR",
      cell: (info) =>
        info.getValue() === null
          ? "—"
          : `${(info.getValue() as number).toFixed(2)}%`,
    }),
    columnHelper.accessor("cost_micros", {
      header: "Spend",
      cell: (info) => formatMicros(info.getValue(), currency),
    }),
    columnHelper.accessor("average_cpc_micros", {
      header: "Avg CPC",
      cell: (info) => formatMicros(info.getValue(), currency),
    }),
    columnHelper.accessor("average_cpm_micros", {
      header: "Avg CPM",
      cell: (info) => formatMicros(info.getValue(), currency),
    }),
    columnHelper.accessor("conversions", {
      header: "Conversions",
      cell: (info) => formatNumber(info.getValue()),
    }),
    columnHelper.accessor("conversions_value", {
      header: "Conv. value",
      cell: (info) =>
        info.getValue() === null ? "—" : formatNumber(info.getValue()!),
    }),
    columnHelper.accessor("video_views", {
      header: "Video views",
      cell: (info) => formatNumber(info.getValue()),
    }),
    columnHelper.accessor("device", {
      header: "Device",
      cell: (info) => info.getValue() || "—",
    }),
  ]

  const handlePaginationChange = useCallback(
    (newPagination: DataTablePaginationState) => {
      const params = new URLSearchParams(searchParams)
      if (newPagination.pageIndex > 0)
        params.set("ins_page", String(newPagination.pageIndex + 1))
      else params.delete("ins_page")
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  const pageStart = pagination.pageIndex * pagination.pageSize
  const pageRows = insights.slice(pageStart, pageStart + pagination.pageSize)

  const table = useDataTable({
    data: pageRows,
    columns,
    rowCount: insights.length,
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
      <div className="flex flex-wrap items-center gap-3 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">
          Level:
        </Text>
        <Select
          size="small"
          value={level}
          onValueChange={(v) => {
            updateParam("level", v)
            updateParam("entity_id", undefined)
          }}
        >
          <Select.Trigger className="w-[150px]">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {levels.map((l) => (
              <Select.Item key={l.value} value={l.value}>
                {l.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">
          Entity:
        </Text>
        <Select
          size="small"
          value={entityId || "all"}
          onValueChange={(v) =>
            updateParam("entity_id", v === "all" ? undefined : v)
          }
        >
          <Select.Trigger className="w-[280px]">
            <Select.Value placeholder="All" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">All ({entityOptions.length})</Select.Item>
            {entityOptions.map((o) => (
              <Select.Item key={o.id} value={o.id}>
                {o.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">
          From:
        </Text>
        <Input
          type="date"
          size="small"
          value={fromDate}
          onChange={(e) => updateParam("from", e.target.value)}
          className="w-[160px]"
        />
        <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">
          To:
        </Text>
        <Input
          type="date"
          size="small"
          value={toDate}
          onChange={(e) => updateParam("to", e.target.value)}
          className="w-[160px]"
        />
      </div>

      <div className="px-6 py-6">
        <Heading level="h3" className="mb-3">
          Trend
        </Heading>
        {chartData.length === 0 ? (
          <Text className="text-ui-fg-subtle" size="small">
            No insights in this window. If you just connected this platform,
            click <span className="font-medium">Sync now</span> above.
          </Text>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
              />
              <Tooltip />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="impressions"
                stroke="#8884d8"
                dot={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="clicks"
                stroke="#82ca9d"
                dot={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="spend"
                stroke="#ff7300"
                dot={false}
                name={`spend (${currency})`}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 w-full px-6 py-4">
          <div>
            <Heading>Daily rows</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              {insights.length} rows in selected window.
            </Text>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}
