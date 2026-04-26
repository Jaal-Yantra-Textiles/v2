import {
  Badge,
  Container,
  DataTable,
  Heading,
  Select,
  Switch,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { ChartBar } from "@medusajs/icons"
import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal"
import {
  MetaAdsOverviewBreakdownRow,
  useAdSet,
  useMetaAdsOverview,
} from "../../../../../hooks/api/meta-ads"
import { createColumnHelper } from "@tanstack/react-table"

const DATE_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Last 7 days", value: "last_7d" },
  { label: "Last 14 days", value: "last_14d" },
  { label: "Last 30 days", value: "last_30d" },
  { label: "Last 90 days", value: "last_90d" },
  { label: "Maximum", value: "maximum" },
]

type ResultsRow = { action_type: string; value: number }

const resultsColumnHelper = createColumnHelper<ResultsRow>()
const breakdownColumnHelper = createColumnHelper<MetaAdsOverviewBreakdownRow>()

const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—"
  return new Intl.NumberFormat("en-US").format(value)
}

const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—"
  return `${value.toFixed(2)}%`
}

const getStatusColor = (status: string | null | undefined): "green" | "orange" | "red" | "grey" => {
  switch (String(status || "").toUpperCase()) {
    case "ACTIVE":
      return "green"
    case "PAUSED":
      return "orange"
    case "DELETED":
      return "red"
    case "ARCHIVED":
      return "grey"
    default:
      return "grey"
  }
}

const MetaAdsAdSetOverviewModalPage = () => {
  const { id } = useParams()

  const [datePreset, setDatePreset] = useState<string>("last_30d")
  const [includeAudience, setIncludeAudience] = useState(true)
  const [includeContent, setIncludeContent] = useState(true)
  const [persist, setPersist] = useState(false)
  const [refreshMode, setRefreshMode] = useState<"auto" | "force" | "never">("auto")
  const [maxAgeMinutes, setMaxAgeMinutes] = useState<number>(60)

  const { data: adSetData, isLoading: isAdSetLoading } = useAdSet(id || "")

  const adSet: any = adSetData?.adSet
  const adAccount = adSet?.ad_account

  const platformId = adAccount?.platform_id
  const metaAccountId = adAccount?.meta_account_id
  const metaAdSetId = adSet?.meta_adset_id

  const { data: overview, isLoading: isOverviewLoading } = useMetaAdsOverview({
    platform_id: platformId || undefined,
    ad_account_id: metaAccountId || undefined,
    level: "adset",
    object_id: metaAdSetId || undefined,
    date_preset: datePreset,
    include_audience: includeAudience,
    include_content: includeContent,
    persist,
    refresh: refreshMode,
    max_age_minutes: maxAgeMinutes,
  })

  const isLoading = isAdSetLoading || isOverviewLoading

  const resultsRows = useMemo<ResultsRow[]>(() => {
    const entries = Object.entries(overview?.results || {})
    return entries
      .map(([action_type, value]) => ({ action_type, value: Number(value || 0) }))
      .sort((a, b) => b.value - a.value)
  }, [overview])

  const resultsColumns = useMemo(
    () => [
      resultsColumnHelper.accessor("action_type", {
        header: "Action",
        cell: ({ getValue }) => <Text size="small">{getValue()}</Text>,
      }),
      resultsColumnHelper.accessor("value", {
        header: "Value",
        cell: ({ getValue }) => <Text size="small">{formatNumber(getValue())}</Text>,
      }),
    ],
    []
  )

  const breakdownColumns = useMemo(
    () => [
      breakdownColumnHelper.accessor("key", {
        header: "Key",
        cell: ({ row }) => (
          <div className="flex flex-col">
            {Object.entries(row.original.key || {}).map(([k, v]) => (
              <Text key={k} size="xsmall" className="text-ui-fg-subtle">
                {k}: {v}
              </Text>
            ))}
          </div>
        ),
      }),
      breakdownColumnHelper.accessor((row) => row.totals.spend, {
        id: "spend",
        header: "Spend",
        cell: ({ getValue }) => <Text size="small">{formatNumber(getValue())}</Text>,
      }),
      breakdownColumnHelper.accessor((row) => row.totals.impressions, {
        id: "impressions",
        header: "Impressions",
        cell: ({ getValue }) => <Text size="small">{formatNumber(getValue())}</Text>,
      }),
      breakdownColumnHelper.accessor((row) => row.totals.clicks, {
        id: "clicks",
        header: "Clicks",
        cell: ({ getValue }) => <Text size="small">{formatNumber(getValue())}</Text>,
      }),
      breakdownColumnHelper.accessor((row) => row.totals.ctr, {
        id: "ctr",
        header: "CTR",
        cell: ({ getValue }) => <Text size="small">{formatPercent(getValue())}</Text>,
      }),
    ],
    []
  )

  const resultsTable = useDataTable({
    data: resultsRows,
    columns: resultsColumns,
    getRowId: (row) => row.action_type,
    rowCount: resultsRows.length,
    isLoading,
  })

  const audienceAgeGenderRows = overview?.audience?.by_age_gender || []
  const audienceCountryRows = overview?.audience?.by_country || []
  const contentPublisherRows = overview?.content?.by_publisher_platform || []
  const contentPositionRows = overview?.content?.by_platform_position || []
  const contentDeviceRows = overview?.content?.by_device_platform || []

  const audienceAgeGenderTable = useDataTable({
    data: audienceAgeGenderRows,
    columns: breakdownColumns,
    getRowId: (_, index) => String(index),
    rowCount: audienceAgeGenderRows.length,
    isLoading,
  })

  const audienceCountryTable = useDataTable({
    data: audienceCountryRows,
    columns: breakdownColumns,
    getRowId: (_, index) => String(index),
    rowCount: audienceCountryRows.length,
    isLoading,
  })

  const contentPublisherTable = useDataTable({
    data: contentPublisherRows,
    columns: breakdownColumns,
    getRowId: (_, index) => String(index),
    rowCount: contentPublisherRows.length,
    isLoading,
  })

  const contentPositionTable = useDataTable({
    data: contentPositionRows,
    columns: breakdownColumns,
    getRowId: (_, index) => String(index),
    rowCount: contentPositionRows.length,
    isLoading,
  })

  const contentDeviceTable = useDataTable({
    data: contentDeviceRows,
    columns: breakdownColumns,
    getRowId: (_, index) => String(index),
    rowCount: contentDeviceRows.length,
    isLoading,
  })

  const topActionsChartData = useMemo(() => {
    return resultsRows.slice(0, 8).map((r) => ({ name: r.action_type, value: r.value }))
  }, [resultsRows])

  const placementsChartData = useMemo(() => {
    const rows = overview?.content?.by_publisher_platform || []
    return rows
      .slice(0, 10)
      .map((r) => ({ name: r.key.publisher_platform || "unknown", spend: Number(r.totals.spend || 0) }))
  }, [overview])

  const totals = overview?.totals

  return (
    <RouteFocusModal prev="../..">
      <RouteFocusModal.Header>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2 min-w-0">
            <ChartBar className="text-ui-fg-subtle" />
            <Heading className="truncate">Ad Set Overview</Heading>
            {adSet?.name && (
              <Text size="small" className="text-ui-fg-subtle truncate">
                {adSet.name}
              </Text>
            )}
          </div>

          <div className="flex items-center gap-2">
            {adSet?.status && (
              <Badge size="2xsmall" color={getStatusColor(adSet.status)}>
                {String(adSet.status)}
              </Badge>
            )}
            {overview?.data_source && (
              <Badge size="2xsmall" color={overview.data_source === "db" ? "grey" : "blue"}>
                Source: {overview.data_source.toUpperCase()}
              </Badge>
            )}
          </div>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="overflow-y-auto">
        <div className="p-4 md:p-6 flex flex-col gap-4 md:gap-6">
          <Container className="divide-y p-0">
            <div className="px-4 md:px-6 py-4">
              <Heading level="h2">Scope</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {metaAccountId || ""}
              </Text>
            </div>

            <div className="px-4 md:px-6 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <Select value={datePreset} onValueChange={setDatePreset}>
                  <Select.Trigger>
                    <Select.Value placeholder="Date preset" />
                  </Select.Trigger>
                  <Select.Content>
                    {DATE_PRESETS.map((p) => (
                      <Select.Item key={p.value} value={p.value}>
                        {p.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>

                <Select value={refreshMode} onValueChange={(v) => setRefreshMode(v as any)}>
                  <Select.Trigger>
                    <Select.Value placeholder="Refresh" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="auto">Refresh: Auto</Select.Item>
                    <Select.Item value="force">Refresh: Force Meta</Select.Item>
                    <Select.Item value="never">Refresh: DB only</Select.Item>
                  </Select.Content>
                </Select>

                <Select value={String(maxAgeMinutes)} onValueChange={(v) => setMaxAgeMinutes(Number(v))}>
                  <Select.Trigger>
                    <Select.Value placeholder="Max age" />
                  </Select.Trigger>
                  <Select.Content>
                    {[15, 30, 60, 180, 720].map((m) => (
                      <Select.Item key={m} value={String(m)}>
                        Max age: {m}m
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                  <div className="flex items-center gap-2">
                    <Switch checked={includeAudience} onCheckedChange={setIncludeAudience} />
                    <Text size="small">Audience</Text>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={includeContent} onCheckedChange={setIncludeContent} />
                    <Text size="small">Placements</Text>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={persist} onCheckedChange={setPersist} />
                    <Text size="small">Persist</Text>
                  </div>
                </div>
              </div>

              {!platformId && !isAdSetLoading && (
                <Text size="small" className="text-ui-fg-subtle mt-3">
                  Loading ad account context...
                </Text>
              )}

              {!metaAdSetId && !isAdSetLoading && (
                <Text size="small" className="text-ui-fg-subtle mt-3">
                  Ad set is missing meta_adset_id.
                </Text>
              )}
            </div>
          </Container>

          {totals && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
                <Text size="small" className="text-ui-fg-subtle">
                  Spend
                </Text>
                <Text className="text-lg font-semibold">{formatNumber(totals.spend)}</Text>
              </div>
              <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
                <Text size="small" className="text-ui-fg-subtle">
                  Impressions
                </Text>
                <Text className="text-lg font-semibold">{formatNumber(totals.impressions)}</Text>
              </div>
              <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
                <Text size="small" className="text-ui-fg-subtle">
                  Clicks
                </Text>
                <Text className="text-lg font-semibold">{formatNumber(totals.clicks)}</Text>
              </div>
              <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
                <Text size="small" className="text-ui-fg-subtle">
                  CTR
                </Text>
                <Text className="text-lg font-semibold">{formatPercent(totals.ctr)}</Text>
              </div>
            </div>
          )}

          <Container className="divide-y p-0">
            <div className="px-4 md:px-6 py-4">
              <Heading level="h2">Top Actions</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Top action types by volume
              </Text>
            </div>
            <div className="px-4 md:px-6 pb-4 md:pb-6 h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topActionsChartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke="var(--ui-border-base)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "var(--ui-fg-subtle)", fontSize: 12 }} />
                  <YAxis tick={{ fill: "var(--ui-fg-subtle)", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--ui-bg-base)",
                      border: "1px solid var(--ui-border-base)",
                      color: "var(--ui-fg-base)",
                    }}
                  />
                  <Bar dataKey="value" fill="var(--ui-fg-interactive)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Container>

          <Container className="divide-y p-0">
            <div className="px-4 md:px-6 py-4">
              <Heading level="h2">Results (all actions)</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Aggregated counts per action type from Meta insights actions array
              </Text>
            </div>
            <DataTable instance={resultsTable}>
              <DataTable.Table />
            </DataTable>
          </Container>

          {includeContent && overview?.content && placementsChartData.length > 0 && (
            <Container className="divide-y p-0">
              <div className="px-4 md:px-6 py-4">
                <Heading level="h2">Placements</Heading>
              </div>
              <div className="px-4 md:px-6 pb-4 md:pb-6 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={placementsChartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="var(--ui-border-base)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "var(--ui-fg-subtle)", fontSize: 12 }} />
                    <YAxis tick={{ fill: "var(--ui-fg-subtle)", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--ui-bg-base)",
                        border: "1px solid var(--ui-border-base)",
                        color: "var(--ui-fg-base)",
                      }}
                    />
                    <Bar dataKey="spend" fill="var(--ui-tag-blue-bg)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Container>
          )}

          {includeAudience && overview?.audience && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              <Container className="divide-y p-0">
                <div className="px-4 md:px-6 py-4">
                  <Heading level="h3">Age & Gender</Heading>
                </div>
                <DataTable instance={audienceAgeGenderTable}>
                  <DataTable.Table />
                </DataTable>
              </Container>

              <Container className="divide-y p-0">
                <div className="px-4 md:px-6 py-4">
                  <Heading level="h3">Country</Heading>
                </div>
                <DataTable instance={audienceCountryTable}>
                  <DataTable.Table />
                </DataTable>
              </Container>
            </div>
          )}

          {includeContent && overview?.content && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
              <Container className="divide-y p-0">
                <div className="px-4 md:px-6 py-4">
                  <Heading level="h3">Publisher Platform</Heading>
                </div>
                <DataTable instance={contentPublisherTable}>
                  <DataTable.Table />
                </DataTable>
              </Container>

              <Container className="divide-y p-0">
                <div className="px-4 md:px-6 py-4">
                  <Heading level="h3">Position</Heading>
                </div>
                <DataTable instance={contentPositionTable}>
                  <DataTable.Table />
                </DataTable>
              </Container>

              <Container className="divide-y p-0">
                <div className="px-4 md:px-6 py-4">
                  <Heading level="h3">Device</Heading>
                </div>
                <DataTable instance={contentDeviceTable}>
                  <DataTable.Table />
                </DataTable>
              </Container>
            </div>
          )}

          {!isLoading && !overview && (
            <Container className="p-6">
              <Text className="text-ui-fg-subtle">No overview data available.</Text>
            </Container>
          )}

          {!isLoading && !adSet && (
            <Container className="p-6">
              <Text className="text-ui-fg-subtle">Ad set not found.</Text>
            </Container>
          )}
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default MetaAdsAdSetOverviewModalPage
