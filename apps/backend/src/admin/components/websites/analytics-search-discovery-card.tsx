import { Container, Heading, Text, Button } from "@medusajs/ui"
import { MagnifyingGlass } from "@medusajs/icons"
import { useWebsiteConsoleStatus, useWebsiteConsoleSync } from "../../hooks/api/search-console"
import { useWebsiteSearchConsoleRollup, type SearchConsoleRollupResponse } from "../../hooks/api/analytics"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—"
  return `${(v * 100).toFixed(1)}%`
}

function formatPosition(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—"
  return v.toFixed(1)
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function RankedBarList({ items, labelKey }: { items: { label: string; clicks: number }[]; labelKey: string }) {
  const total = items.reduce((sum, it) => sum + it.clicks, 0)
  const max = items.reduce((m, it) => Math.max(m, it.clicks), 0) || 1

  if (items.length === 0) {
    return <Text size="small" className="text-ui-fg-muted">No data</Text>
  }

  return (
    <div className="flex flex-col gap-y-3 w-full">
      {items.map((item, index) => {
        const pct = total > 0 ? Math.round((item.clicks / total) * 100) : 0
        const width = `${Math.max((item.clicks / max) * 100, 2)}%`
        return (
          <div key={`${labelKey}-${index}`} className="flex flex-col gap-y-1">
            <div className="flex items-center justify-between text-ui-fg-subtle">
              <Text size="small" className="font-medium text-ui-fg-base truncate pr-2">{item.label}</Text>
              <Text size="xsmall" className="tabular-nums whitespace-nowrap">
                {formatCount(item.clicks)} clicks · {pct}%
              </Text>
            </div>
            <div className="h-2 w-full rounded-full bg-ui-bg-component overflow-hidden">
              <div className="h-full rounded-full bg-ui-fg-muted transition-all" style={{ width }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ui-bg-base p-3 rounded-lg border border-ui-border-base flex flex-col gap-y-1">
      <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide font-medium">{label}</Text>
      <Text className="text-xl font-bold">{value}</Text>
    </div>
  )
}

function SyncButton({ websiteId }: { websiteId: string }) {
  const sync = useWebsiteConsoleSync(websiteId)

  return (
    <Button
      size="small"
      variant="secondary"
      isLoading={sync.isPending}
      onClick={() => sync.mutate({ window_days: 30 })}
    >
      {sync.isPending ? "Syncing..." : "Sync Data"}
    </Button>
  )
}

type Props = {
  websiteId: string
  days: number
}

export const AnalyticsSearchDiscoveryCard = ({ websiteId, days }: Props) => {
  const { data: status, isLoading: statusLoading } = useWebsiteConsoleStatus(websiteId)
  const { data: gsc, isLoading: gscLoading } = useWebsiteSearchConsoleRollup(websiteId, days)

  const loading = statusLoading || gscLoading
  const notBound = status && !status.bound
  const boundNoSync = gsc && gsc.bound && !gsc.synced
  const hasData = gsc && gsc.bound && gsc.synced && (gsc.total.clicks > 0 || gsc.total.impressions > 0 || gsc.top_queries.length > 0)
  const empty = gsc && gsc.bound && gsc.synced && !hasData

  if (loading) {
    return (
      <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
        <div className="p-4 border-b border-ui-border-base flex items-center gap-x-2">
          <MagnifyingGlass className="text-ui-fg-subtle" />
          <Heading level="h3" className="text-sm font-medium">Search / Discovery</Heading>
        </div>
        <div className="p-6 flex items-center justify-center">
          <Text className="text-ui-fg-subtle">Loading...</Text>
        </div>
      </Container>
    )
  }

  if (notBound) {
    return (
      <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
        <div className="p-4 border-b border-ui-border-base flex items-center gap-x-2">
          <MagnifyingGlass className="text-ui-fg-subtle" />
          <Heading level="h3" className="text-sm font-medium">Search / Discovery</Heading>
        </div>
        <div className="p-6 flex flex-col items-center gap-y-3 text-center">
          <Text className="text-ui-fg-muted text-sm">
            No Google Search Console property connected to this website.
          </Text>
          {status?.candidates && status.candidates.length > 0 && (
            <div className="flex flex-col gap-y-1">
              <Text size="xsmall" className="text-ui-fg-subtle">
                Expected candidates: {status.candidates.join(", ")}
              </Text>
            </div>
          )}
          <a
            href={`/settings/platforms`}
            className="text-ui-fg-interactive text-sm underline"
          >
            Connect in Settings
          </a>
        </div>
      </Container>
    )
  }

  if (boundNoSync) {
    return (
      <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
        <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
          <div className="flex items-center gap-x-2">
            <MagnifyingGlass className="text-ui-fg-subtle" />
            <Heading level="h3" className="text-sm font-medium">Search / Discovery</Heading>
          </div>
          {gsc?.binding && (
            <Text size="xsmall" className="text-ui-fg-subtle font-mono">
              {gsc.binding.resource_id}
            </Text>
          )}
        </div>
        <div className="p-6 flex flex-col items-center gap-y-3 text-center">
          <Text className="text-ui-fg-muted text-sm">
            Connected but no data synced yet.
          </Text>
          <SyncButton websiteId={websiteId} />
        </div>
      </Container>
    )
  }

  if (empty) {
    return (
      <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
        <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
          <div className="flex items-center gap-x-2">
            <MagnifyingGlass className="text-ui-fg-subtle" />
            <Heading level="h3" className="text-sm font-medium">Search / Discovery</Heading>
          </div>
          <div className="flex items-center gap-x-2">
            {gsc?.binding && (
              <Text size="xsmall" className="text-ui-fg-subtle font-mono">
                {gsc.binding.resource_id}
              </Text>
            )}
            <SyncButton websiteId={websiteId} />
          </div>
        </div>
        <div className="p-6 flex items-center justify-center">
          <Text className="text-ui-fg-muted text-sm">No search data in this period.</Text>
        </div>
      </Container>
    )
  }

  if (!gsc) return null

  const chartData = gsc.timeseries.map((d) => ({
    date: d.date.slice(5),
    clicks: d.clicks,
    impressions: d.impressions,
  }))

  const topQueries = gsc.top_queries.map((q) => ({ label: q.query, clicks: q.clicks }))
  const topPages = gsc.top_pages.map((p) => ({ label: p.page, clicks: p.clicks }))

  return (
    <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
      <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
        <div className="flex items-center gap-x-2">
          <MagnifyingGlass className="text-ui-fg-subtle" />
          <Heading level="h3" className="text-sm font-medium">Search / Discovery</Heading>
        </div>
        <div className="flex items-center gap-x-2">
          {gsc.binding && (
            <Text size="xsmall" className="text-ui-fg-subtle font-mono">
              {gsc.binding.resource_id}
            </Text>
          )}
          <SyncButton websiteId={websiteId} />
        </div>
      </div>

      <div className="p-4 flex flex-col gap-y-6">
        <div className="grid grid-cols-4 gap-3">
          <MetricStat label="Clicks" value={formatCount(gsc.total.clicks)} />
          <MetricStat label="Impressions" value={formatCount(gsc.total.impressions)} />
          <MetricStat label="CTR" value={formatPercent(gsc.total.ctr)} />
          <MetricStat label="Avg. Position" value={formatPosition(gsc.total.position)} />
        </div>

        {chartData.length > 0 && (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="impressions"
                  stroke="#8b5cf6"
                  fill="#8b5cf6"
                  fillOpacity={0.1}
                  name="Impressions"
                />
                <Area
                  type="monotone"
                  dataKey="clicks"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.1}
                  name="Clicks"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-y-3">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle uppercase tracking-wide">
              Top Queries
            </Text>
            <RankedBarList items={topQueries} labelKey="query" />
          </div>

          <div className="flex flex-col gap-y-3">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle uppercase tracking-wide">
              Top Pages
            </Text>
            <RankedBarList items={topPages} labelKey="page" />
          </div>
        </div>
      </div>
    </Container>
  )
}
