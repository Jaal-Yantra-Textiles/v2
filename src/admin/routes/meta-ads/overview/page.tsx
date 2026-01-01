import {
  Badge,
  Container,
  DataTable,
  Heading,
  Input,
  Select,
  Switch,
  Text,
  Toaster,
  useDataTable,
} from "@medusajs/ui"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { useMemo, useState } from "react"
import { createColumnHelper } from "@tanstack/react-table"
import { useNavigate, type LoaderFunctionArgs } from "react-router-dom"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  MetaAdsOverviewBreakdownRow,
  MetaAdsOverviewLevel,
  useAdAccounts,
  useAdCampaigns,
  useAdSets,
  useAds,
  useMetaAdsOverview,
} from "../../../hooks/api/meta-ads"
import { useSocialPlatforms } from "../../../hooks/api/social-platforms"

const LEVELS: Array<{ label: string; value: MetaAdsOverviewLevel }> = [
  { label: "Account", value: "account" },
  { label: "Campaign", value: "campaign" },
  { label: "Ad Set", value: "adset" },
  { label: "Ad", value: "ad" },
]

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

const MetaAdsOverviewPage = () => {
  const navigate = useNavigate()
  const { socialPlatforms } = useSocialPlatforms({ limit: 100 })
  const { data: accountsData } = useAdAccounts()

  const metaPlatforms = useMemo(() => {
    return (
      socialPlatforms?.filter(
        (p) =>
          p.name.toLowerCase().includes("facebook") ||
          p.name.toLowerCase().includes("instagram") ||
          p.name.toLowerCase().includes("meta")
      ) || []
    )
  }, [socialPlatforms])

  const [platformId, setPlatformId] = useState<string>("")
  const [adAccountId, setAdAccountId] = useState<string>("")
  const [level, setLevel] = useState<MetaAdsOverviewLevel>("account")
  const [groupBy, setGroupBy] = useState<"campaign" | "adset" | "ad">("campaign")
  const [datePreset, setDatePreset] = useState<string>("last_30d")
  const [includeAudience, setIncludeAudience] = useState(true)
  const [includeContent, setIncludeContent] = useState(true)
  const [persist, setPersist] = useState(true)
  const [refreshMode, setRefreshMode] = useState<"auto" | "force" | "never">("auto")
  const [maxAgeMinutes, setMaxAgeMinutes] = useState<number>(60)
  const [objectId, setObjectId] = useState<string>("")

  const adAccounts = accountsData?.accounts || []

  const { data: campaignsData } = useAdCampaigns({
    ad_account_id: adAccountId || undefined,
    limit: 200,
    offset: 0,
  })

  const { data: adSetsData } = useAdSets({
    ad_account_id: adAccountId || undefined,
    limit: 200,
    offset: 0,
  })

  const { data: adsData } = useAds({
    ad_account_id: adAccountId || undefined,
    limit: 200,
    offset: 0,
  })

  const campaignOptions = useMemo(() => {
    const campaigns = campaignsData?.campaigns || []
    return campaigns.map((c) => ({ label: c.name, value: c.meta_campaign_id }))
  }, [campaignsData])

  const topCampaigns = useMemo(() => {
    const campaigns = campaignsData?.campaigns || []

    return [...campaigns]
      .sort((a: any, b: any) => {
        const sa = Number(a?.spend || 0)
        const sb = Number(b?.spend || 0)
        return sb - sa
      })
      .slice(0, 10)
  }, [campaignsData])

  const topAdSets = useMemo(() => {
    const adSets = (adSetsData as any)?.adSets || []

    return [...adSets]
      .sort((a: any, b: any) => {
        const sa = Number(a?.spend || 0)
        const sb = Number(b?.spend || 0)
        return sb - sa
      })
      .slice(0, 10)
  }, [adSetsData])

  const topAds = useMemo(() => {
    const ads = (adsData as any)?.ads || []

    return [...ads]
      .sort((a: any, b: any) => {
        const sa = Number(a?.spend || 0)
        const sb = Number(b?.spend || 0)
        return sb - sa
      })
      .slice(0, 10)
  }, [adsData])

  const effectiveObjectId = useMemo(() => {
    if (level === "account") return undefined
    if (level === "campaign") return objectId
    return objectId
  }, [level, objectId])

  const { data: overview, isLoading } = useMetaAdsOverview({
    platform_id: platformId || undefined,
    ad_account_id: adAccountId || undefined,
    level,
    object_id: effectiveObjectId || undefined,
    date_preset: datePreset,
    include_audience: includeAudience,
    include_content: includeContent,
    persist,
    refresh: refreshMode,
    max_age_minutes: maxAgeMinutes,
  })

  const resultsRows: ResultsRow[] = useMemo(() => {
    const rows = Object.entries(overview?.results || {}).map(([k, v]) => ({
      action_type: k,
      value: v,
    }))

    return rows.sort((a, b) => b.value - a.value)
  }, [overview])

  const topActionsChartData = useMemo(() => {
    return resultsRows.slice(0, 8).map((r) => ({ name: r.action_type, value: r.value }))
  }, [resultsRows])

  const placementsChartData = useMemo(() => {
    const rows = overview?.content?.by_publisher_platform || []
    return rows
      .slice(0, 8)
      .map((r) => ({
        name: Object.values(r.key || {})[0] || "—",
        spend: (r.totals as any)?.spend || 0,
      }))
  }, [overview])

  const audienceAgeGenderChartData = useMemo(() => {
    const rows = overview?.audience?.by_age_gender || []

    const byAge: Record<string, { age: string; male: number; female: number; unknown: number }> = {}

    for (const r of rows) {
      const age = (r.key as any)?.age || "unknown"
      const gender = ((r.key as any)?.gender || "unknown").toLowerCase()
      const spend = (r.totals as any)?.spend || 0

      if (!byAge[age]) {
        byAge[age] = { age, male: 0, female: 0, unknown: 0 }
      }

      if (gender === "male") byAge[age].male += spend
      else if (gender === "female") byAge[age].female += spend
      else byAge[age].unknown += spend
    }

    const list = Object.values(byAge)

    // Sort age buckets roughly (handles ranges like 18-24 and "unknown")
    list.sort((a, b) => {
      const parseAgeStart = (age: string) => {
        const s = String(age || "").trim().toLowerCase()
        if (!s || s === "unknown") return Number.POSITIVE_INFINITY
        if (s.includes("+")) {
          const n = parseInt(s.replace("+", ""), 10)
          return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
        }
        const first = s.split("-")[0]
        const n = parseInt(first, 10)
        return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
      }

      const pa = parseAgeStart(a.age)
      const pb = parseAgeStart(b.age)
      if (pa !== pb) return pa - pb
      return String(a.age).localeCompare(String(b.age))
    })

    return list
  }, [overview])

  const audienceCountryChartData = useMemo(() => {
    const rows = overview?.audience?.by_country || []
    return rows
      .slice(0, 10)
      .map((r) => ({ name: (r.key as any)?.country || "unknown", spend: (r.totals as any)?.spend || 0 }))
  }, [overview])

  const resultsTable = useDataTable({
    data: resultsRows,
    columns: [
      resultsColumnHelper.accessor("action_type", {
        header: "Action",
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      }),
      resultsColumnHelper.accessor("value", {
        header: "Value",
        cell: ({ getValue }) => formatNumber(getValue()),
      }),
    ],
    getRowId: (row) => row.action_type,
    rowCount: resultsRows.length,
    isLoading,
  })

  const breakdownColumns = useMemo(
    () => [
      breakdownColumnHelper.accessor("key", {
        header: "Key",
        cell: ({ getValue }) => {
          const obj = getValue() || {}
          const label = Object.entries(obj)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
          return <span className="font-medium">{label || "—"}</span>
        },
      }),
      breakdownColumnHelper.accessor("totals.spend", {
        header: "Spend",
        cell: ({ getValue }) => formatNumber(getValue() as any),
      }),
      breakdownColumnHelper.accessor("totals.impressions", {
        header: "Impressions",
        cell: ({ getValue }) => formatNumber(getValue() as any),
      }),
      breakdownColumnHelper.accessor("totals.clicks", {
        header: "Clicks",
        cell: ({ getValue }) => formatNumber(getValue() as any),
      }),
    ],
    []
  )

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

  const totals = overview?.totals

  return (
    <>
      <Toaster />
      <Container className="divide-y p-0">
      <div className="px-4 md:px-6 py-4">
        <Heading>Meta Ads Overview</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Aggregated results, audience, and placement overview (select scope level)
        </Text>
      </div>

      <div className="px-4 md:px-6 py-4">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select
              value={platformId}
              onValueChange={(value) => {
                setPlatformId(value)
                setAdAccountId("")
              }}
            >
              <Select.Trigger>
                <Select.Value placeholder="Platform" />
              </Select.Trigger>
              <Select.Content>
                {metaPlatforms.map((p) => (
                  <Select.Item key={p.id} value={p.id}>
                    {p.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>

            <Select
              value={adAccountId}
              onValueChange={(value) => {
                setAdAccountId(value)
                setObjectId("")
              }}
              disabled={!platformId}
            >
              <Select.Trigger>
                <Select.Value placeholder="Ad Account" />
              </Select.Trigger>
              <Select.Content>
                {adAccounts.map((a) => (
                  <Select.Item key={a.id} value={a.meta_account_id}>
                    {a.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>

            <Select
              value={level}
              onValueChange={(value) => {
                setLevel(value as MetaAdsOverviewLevel)
                setObjectId("")
              }}
              disabled={!adAccountId}
            >
              <Select.Trigger>
                <Select.Value placeholder="Level" />
              </Select.Trigger>
              <Select.Content>
                {LEVELS.map((l) => (
                  <Select.Item key={l.value} value={l.value}>
                    {l.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <Select value={datePreset} onValueChange={setDatePreset} disabled={!adAccountId}>
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

            {level === "campaign" ? (
              <Select value={objectId} onValueChange={setObjectId} disabled={!adAccountId}>
                <Select.Trigger>
                  <Select.Value placeholder="Campaign" />
                </Select.Trigger>
                <Select.Content>
                  {campaignOptions.map((c) => (
                    <Select.Item key={c.value} value={c.value}>
                      {c.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            ) : level !== "account" ? (
              <Input
                value={objectId}
                onChange={(e) => setObjectId(e.target.value)}
                placeholder="Object ID (Meta ID)"
                disabled={!adAccountId}
              />
            ) : (
              <div className="hidden lg:block" />
            )}

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

            <Input
              value={String(maxAgeMinutes)}
              onChange={(e) => {
                const n = Number(e.target.value)
                setMaxAgeMinutes(Number.isFinite(n) ? n : 60)
              }}
              placeholder="Max age (minutes)"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

          {persist && overview?.persistence?.enabled && (
            <div>
              <Badge size="2xsmall" color={overview.persistence.errors > 0 ? "orange" : "green"}>
                Saved: {overview.persistence.created} new, {overview.persistence.updated} updated
              </Badge>
            </div>
          )}

          {overview?.scope?.last_synced_at && (
            <div>
              <Badge size="2xsmall" color="grey">
                Last synced: {new Date(overview.scope.last_synced_at).toLocaleString()}
              </Badge>
            </div>
          )}

          {overview?.data_source && (
            <div>
              <Badge size="2xsmall" color={overview.data_source === "db" ? "grey" : "blue"}>
                Source: {overview.data_source.toUpperCase()}
              </Badge>
            </div>
          )}

          {overview?.capabilities?.remote_ad_creation?.supported ? (
            <div>
              <Badge size="2xsmall" color="green">
                Remote ad creation supported
              </Badge>
            </div>
          ) : (
            <div>
              <Badge size="2xsmall" color="grey">
                Remote ad creation (coming soon)
              </Badge>
            </div>
          )}
        </div>
      </div>

      {totals && (
        <div className="px-4 md:px-6 py-4">
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

          <Container className="divide-y p-0 mt-4">
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
        </div>
      )}

      {level === "account" && adAccountId && (topCampaigns.length > 0 || topAdSets.length > 0 || topAds.length > 0) && (
        <div className="px-4 md:px-6 py-4">
          <Container className="divide-y p-0">
            <div className="px-4 md:px-6 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <Heading level="h2">
                    {groupBy === "campaign"
                      ? "Top Campaigns"
                      : groupBy === "adset"
                        ? "Top Ad Sets"
                        : "Top Ads"}
                  </Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    Summary by {groupBy === "campaign" ? "campaign" : groupBy === "adset" ? "ad set" : "ad"} (tap a row to open details)
                  </Text>
                </div>

                <div className="w-full md:w-[220px]">
                  <Select value={groupBy} onValueChange={(v) => setGroupBy(v as any)}>
                    <Select.Trigger>
                      <Select.Value placeholder="Group by" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="campaign">Group: Campaigns</Select.Item>
                      <Select.Item value="adset">Group: Ad Sets</Select.Item>
                      <Select.Item value="ad">Group: Ads</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
              </div>
            </div>

            <div className="divide-y">
              {groupBy === "campaign" &&
                topCampaigns.map((c: any) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full text-left px-4 md:px-6 py-4 hover:bg-ui-bg-subtle transition-colors"
                    onClick={() => navigate(`/meta-ads/overview/campaigns/${c.id}`)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Text className="font-medium truncate">{c.name}</Text>
                          <Badge size="2xsmall" color={getStatusColor(c.status)}>
                            {String(c.status || "UNKNOWN")}
                          </Badge>
                        </div>
                        {c.objective && (
                          <Text size="xsmall" className="text-ui-fg-subtle mt-1 truncate">
                            {String(c.objective).replace("OUTCOME_", "").replace(/_/g, " ")}
                          </Text>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        <Text size="small" className="font-medium">
                          {formatNumber(Number(c.spend || 0))}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          spend
                        </Text>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Impressions
                        </Text>
                        <Text size="small">{formatNumber(Number(c.impressions || 0))}</Text>
                      </div>
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Reach
                        </Text>
                        <Text size="small">{formatNumber(Number(c.reach || 0))}</Text>
                      </div>
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Clicks
                        </Text>
                        <Text size="small">{formatNumber(Number(c.clicks || 0))}</Text>
                      </div>
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          CTR
                        </Text>
                        <Text size="small">{formatPercent(Number(c.ctr || 0))}</Text>
                      </div>
                    </div>
                  </button>
                ))}

              {groupBy === "adset" &&
                topAdSets.map((as: any) => (
                  <button
                    key={as.id}
                    type="button"
                    className="w-full text-left px-4 md:px-6 py-4 hover:bg-ui-bg-subtle transition-colors"
                    onClick={() => navigate(`/meta-ads/overview/adsets/${as.id}`)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Text className="font-medium truncate">{as.name}</Text>
                          <Badge size="2xsmall" color={getStatusColor(as.status)}>
                            {String(as.status || "UNKNOWN")}
                          </Badge>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <Text size="small" className="font-medium">
                          {formatNumber(Number(as.spend || 0))}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          spend
                        </Text>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Impressions
                        </Text>
                        <Text size="small">{formatNumber(Number(as.impressions || 0))}</Text>
                      </div>
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Reach
                        </Text>
                        <Text size="small">{formatNumber(Number(as.reach || 0))}</Text>
                      </div>
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Clicks
                        </Text>
                        <Text size="small">{formatNumber(Number(as.clicks || 0))}</Text>
                      </div>
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          CTR
                        </Text>
                        <Text size="small">{formatPercent(Number(as.ctr || 0))}</Text>
                      </div>
                    </div>
                  </button>
                ))}

              {groupBy === "ad" &&
                topAds.map((a: any) => (
                  <button
                    key={a.id}
                    type="button"
                    className="w-full text-left px-4 md:px-6 py-4 hover:bg-ui-bg-subtle transition-colors"
                    onClick={() => navigate(`/meta-ads/overview/ads/${a.id}`)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Text className="font-medium truncate">{a.name}</Text>
                          <Badge size="2xsmall" color={getStatusColor(a.status)}>
                            {String(a.status || "UNKNOWN")}
                          </Badge>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <Text size="small" className="font-medium">
                          {formatNumber(Number(a.spend || 0))}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          spend
                        </Text>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Impressions
                        </Text>
                        <Text size="small">{formatNumber(Number(a.impressions || 0))}</Text>
                      </div>
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Reach
                        </Text>
                        <Text size="small">{formatNumber(Number(a.reach || 0))}</Text>
                      </div>
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Clicks
                        </Text>
                        <Text size="small">{formatNumber(Number(a.clicks || 0))}</Text>
                      </div>
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          CTR
                        </Text>
                        <Text size="small">{formatPercent(Number(a.ctr || 0))}</Text>
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          </Container>
        </div>
      )}

      <div className="px-4 md:px-6 py-4">
        <Heading level="h2">Results (all actions)</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Aggregated counts per action type from Meta insights actions array
        </Text>
      </div>

      <DataTable instance={resultsTable}>
        <DataTable.Table />
      </DataTable>

      {includeAudience && overview?.audience && (
        <>
          <div className="px-4 md:px-6 py-4">
            <Heading level="h2">Audience</Heading>
          </div>

          {(audienceAgeGenderChartData.length > 0 || audienceCountryChartData.length > 0) && (
            <div className="px-4 md:px-6 pb-4 md:pb-6 grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              <Container className="divide-y p-0">
                <div className="px-4 md:px-6 py-4">
                  <Heading level="h3">Spend by Age & Gender</Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    Stacked spend distribution
                  </Text>
                </div>
                <div className="px-4 md:px-6 pb-4 md:pb-6 h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={audienceAgeGenderChartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid stroke="var(--ui-border-base)" vertical={false} />
                      <XAxis dataKey="age" tick={{ fill: "var(--ui-fg-subtle)", fontSize: 12 }} />
                      <YAxis tick={{ fill: "var(--ui-fg-subtle)", fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--ui-bg-base)",
                          border: "1px solid var(--ui-border-base)",
                          color: "var(--ui-fg-base)",
                        }}
                      />
                      <Bar dataKey="male" stackId="a" fill="var(--ui-tag-blue-bg)" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="female" stackId="a" fill="var(--ui-tag-green-bg)" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="unknown" stackId="a" fill="var(--ui-tag-orange-bg)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Container>

              <Container className="divide-y p-0">
                <div className="px-4 md:px-6 py-4">
                  <Heading level="h3">Top Countries by Spend</Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    Highest spend countries
                  </Text>
                </div>
                <div className="px-4 md:px-6 pb-4 md:pb-6 h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={audienceCountryChartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
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
                      <Bar dataKey="spend" fill="var(--ui-fg-interactive)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Container>
            </div>
          )}

          <div className="px-4 md:px-6 pb-4 md:pb-6 grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
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
        </>
      )}

      {includeContent && overview?.content && (
        <>
          <div className="px-4 md:px-6 py-4">
            <Heading level="h2">Placement / Content Overview</Heading>
          </div>

          {placementsChartData.length > 0 && (
            <div className="px-4 md:px-6 pb-4 md:pb-6">
              <Container className="divide-y p-0">
                <div className="px-4 md:px-6 py-4">
                  <Heading level="h3">Spend by Publisher Platform</Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    Top platforms by spend
                  </Text>
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
            </div>
          )}

          <div className="px-4 md:px-6 pb-4 md:pb-6 grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
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
        </>
      )}
    </Container>
    </>
  )
}

export const config = defineRouteConfig({
  label: "Meta Ads Overview",
  nested: "/promotions",
  icon: ChartBar,
})

export const handle = {
  breadcrumb: () => "Meta Ads Overview",
}

export async function loader(args: LoaderFunctionArgs) {
  const { metaAdsOverviewLoader } = await import("./loader")
  return metaAdsOverviewLoader(args)
}

export default MetaAdsOverviewPage
