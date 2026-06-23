import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { Badge, Container, Heading, Skeleton, Text } from "@medusajs/ui"
import { useMarketingHeadline } from "../../hooks/api/marketing"

// Mirrors formatMetricDisplay in workflows/marketing/generate-ideas-email.ts so
// the strip reads the SAME way as the AI email. The snapshot `unit` is the
// uppercased currency_code (e.g. "INR") for money metrics, or "ratio"/"count"/
// "percent" for derived ones.
const round1 = (n: number): number => Math.round(n * 10) / 10

const formatValue = (value: number, unit: string | null): string => {
  const u = (unit || "").toLowerCase()
  if (u === "inr") return "₹" + Math.round(value).toLocaleString("en-IN")
  if (u === "usd") return "$" + Math.round(value).toLocaleString("en-US")
  if (u === "eur") return "€" + Math.round(value).toLocaleString("en-IE")
  if (u === "percent") return `${round1(value)}%`
  if (u === "ratio") return `${round1(value * 100)}%`
  if (u === "count") return Math.round(value).toLocaleString("en-IN")
  const base = value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return unit ? `${base} ${unit}` : base
}

// delta_dod is a day-over-day PERCENTAGE (matches how the ideas-email renders it).
const formatDelta = (delta: number | null): string => {
  if (delta === null) return "-"
  const sign = delta >= 0 ? "+" : ""
  return `${sign}${delta.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
}

const MarketingPage = () => {
  const { data, isLoading, isError } = useMarketingHeadline()

  if (isLoading) {
    return (
      <Container className="px-6 py-4">
        <div className="flex flex-col gap-y-6">
          <Skeleton className="h-8 w-48 rounded-md" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </Container>
    )
  }

  if (isError) {
    return (
      <Container className="px-6 py-4">
        <Text className="text-ui-fg-error">
          Failed to load marketing data.
        </Text>
      </Container>
    )
  }

  const headline = data?.headline
  const strip = data?.strip ?? []
  const stale = data?.stale ?? false

  return (
    <Container className="px-6 py-4">
      <div className="flex flex-col gap-y-6">
        {/* Header + stale badge */}
        <div className="flex items-center gap-3">
          <Heading level="h1">Marketing</Heading>
          {stale && (
            <Badge color="orange" size="xsmall">
              Stale
            </Badge>
          )}
        </div>

        {/* Headline / One-Goal card */}
        {headline ? (
          <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-6">
            <Text
              size="xsmall"
              leading="compact"
              className="text-ui-fg-subtle uppercase tracking-wider"
            >
              {headline.metric_key.replace(/_/g, " ")}
            </Text>
            <div className="flex items-baseline gap-3 mt-2">
              <Text size="xlarge" leading="compact" weight="plus">
                {formatValue(headline.value, headline.unit)}
              </Text>
              {headline.dod_delta !== null && (
                <Text
                  size="small"
                  leading="compact"
                  weight="plus"
                  className={
                    headline.dod_delta >= 0
                      ? "text-ui-fg-positive"
                      : "text-ui-fg-error"
                  }
                >
                  {formatDelta(headline.dod_delta)}
                </Text>
              )}
            </div>
            <Text
              size="xsmall"
              leading="compact"
              className="text-ui-fg-muted mt-1"
            >
              {headline.as_of_date
                ? `as of ${new Date(headline.as_of_date).toLocaleDateString()}`
                : ""}
            </Text>
          </div>
        ) : (
          <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-6">
            <Text size="small" leading="compact" className="text-ui-fg-muted">
              No headline metric available yet. Data will appear after the first
              sync.
            </Text>
          </div>
        )}

        {/* Strip — secondary KPI cards */}
        {strip.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {strip.map((metric) => (
              <div
                key={metric.metric_key}
                className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4"
              >
                <Text
                  size="xsmall"
                  leading="compact"
                  className="text-ui-fg-subtle"
                >
                  {metric.metric_key.replace(/_/g, " ")}
                </Text>
                <Text
                  size="large"
                  leading="compact"
                  weight="plus"
                  className="mt-1"
                >
                  {formatValue(metric.value, metric.unit)}
                </Text>
                {metric.dod_delta !== null && (
                  <Text
                    size="xsmall"
                    leading="compact"
                    className={
                      metric.dod_delta >= 0
                        ? "text-ui-fg-positive mt-0.5"
                        : "text-ui-fg-error mt-0.5"
                    }
                  >
                    {formatDelta(metric.dod_delta)}
                  </Text>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Marketing",
  icon: ChartBar,
})

export const handle = {
  breadcrumb: () => "Marketing",
}

export default MarketingPage
