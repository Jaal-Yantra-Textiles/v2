/**
 * Ad Planning Dashboard - Quick Navigation with Live KPIs
 * Landing page with live metrics summary and links to all ad-planning modules
 */

import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { Container, Heading, Text, Button, Badge } from "@medusajs/ui"
import { Link, Outlet } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

const KPICard = ({
  title,
  value,
  subtitle,
  color,
}: {
  title: string
  value: string | number
  subtitle?: string
  color?: string
}) => (
  <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
    <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
      {title}
    </Text>
    <Text
      size="xlarge"
      leading="compact"
      weight="plus"
      className={`mt-1 ${color || ""}`}
    >
      {value}
    </Text>
    {subtitle && (
      <Text size="xsmall" leading="compact" className="text-ui-fg-muted mt-0.5">
        {subtitle}
      </Text>
    )}
  </div>
)

const QuickLinkCard = ({
  title,
  description,
  to,
  badge,
}: {
  title: string
  description: string
  to: string
  badge?: { label: string; color: "green" | "blue" | "orange" | "purple" | "grey" }
}) => (
  <Link
    to={to}
    className="block outline-none focus:shadow-borders-interactive-with-focus rounded-lg"
  >
    <div className="shadow-elevation-card-rest bg-ui-bg-component hover:bg-ui-bg-component-hover rounded-lg p-5 transition-colors">
      <div className="flex items-center justify-between">
        <Text size="base" leading="compact" weight="plus">
          {title}
        </Text>
        {badge && (
          <Badge color={badge.color} size="xsmall">
            {badge.label}
          </Badge>
        )}
      </div>
      <Text size="small" leading="compact" className="text-ui-fg-subtle mt-1">
        {description}
      </Text>
    </div>
  </Link>
)

const AdPlanningDashboard = () => {
  // Fetch live KPI data
  const { data: conversionStats } = useQuery({
    queryKey: ["ad-planning", "dashboard", "conversions"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/conversions/stats")
      return res
    },
  })

  const { data: segmentsData } = useQuery({
    queryKey: ["ad-planning", "dashboard", "segments"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/segments?limit=100")
      return res
    },
  })

  const { data: experimentsData } = useQuery({
    queryKey: ["ad-planning", "dashboard", "experiments"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/experiments?limit=50")
      return res
    },
  })

  const { data: attrStats } = useQuery({
    queryKey: ["ad-planning", "dashboard", "attribution"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/attribution/stats")
      return res
    },
  })

  const { data: scoresData } = useQuery({
    queryKey: ["ad-planning", "dashboard", "scores"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/scores?limit=1")
      return res
    },
  })

  // Derived KPIs
  const totalConversions = conversionStats?.total_conversions || 0
  const totalRevenue = conversionStats?.total_value || 0
  const activeSegments = segmentsData?.segments?.filter((s: any) => s.is_active).length || 0
  const totalMembers = segmentsData?.segments?.reduce(
    (acc: number, s: any) => acc + (s.customer_count || 0), 0
  ) || 0
  const runningExperiments = experimentsData?.experiments?.filter(
    (e: any) => e.status === "running"
  ).length || 0
  const resolutionRate = attrStats?.totals?.resolution_rate
    ? `${Math.round(attrStats.totals.resolution_rate)}%`
    : "-"
  const totalScored = scoresData?.aggregates
    ? Object.values(scoresData.aggregates).reduce((acc: number, a: any) => acc + (a?.count || 0), 0) as number
    : 0

  return (
    <>
      <div className="flex flex-col gap-y-6">
        {/* Header */}
        <Container className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h1">Ad Planning & Attribution</Heading>
            <Text
              size="small"
              leading="compact"
              className="text-ui-fg-subtle mt-1"
            >
              Manage conversions, experiments, segments, journeys, scores, and
              attribution
            </Text>
          </div>
          <Link to="/ad-planning/metrics">
            <Button size="small" variant="secondary">
              <ChartBar className="mr-2" />
              View Metrics
            </Button>
          </Link>
        </Container>

        {/* Live KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPICard
            title="Conversions"
            value={totalConversions.toLocaleString()}
            subtitle="All time"
          />
          <KPICard
            title="Revenue"
            value={totalRevenue > 0 ? `₹${(totalRevenue / 100).toLocaleString()}` : "₹0"}
            color="text-ui-fg-positive"
          />
          <KPICard
            title="Active Segments"
            value={activeSegments}
            subtitle={`${totalMembers.toLocaleString()} members`}
          />
          <KPICard
            title="Experiments"
            value={runningExperiments}
            subtitle="Running"
            color={runningExperiments > 0 ? "text-ui-fg-interactive" : ""}
          />
          <KPICard
            title="Attribution Rate"
            value={resolutionRate}
            subtitle={`${attrStats?.totals?.total_sessions || 0} sessions`}
          />
          <KPICard
            title="Scored Customers"
            value={totalScored.toLocaleString()}
          />
        </div>

        {/* Quick Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <QuickLinkCard
            title="Conversions"
            description="Track and analyze conversion events"
            to="/ad-planning/conversions"
            badge={totalConversions > 0 ? { label: `${totalConversions}`, color: "green" } : undefined}
          />
          <QuickLinkCard
            title="A/B Experiments"
            description="Create and manage A/B tests"
            to="/ad-planning/experiments"
            badge={runningExperiments > 0 ? { label: `${runningExperiments} running`, color: "blue" } : undefined}
          />
          <QuickLinkCard
            title="Customer Journeys"
            description="Visualize customer touchpoints and funnel analysis"
            to="/ad-planning/journeys"
          />
          <QuickLinkCard
            title="Customer Segments"
            description="Create and manage audience segments"
            to="/ad-planning/segments"
            badge={activeSegments > 0 ? { label: `${activeSegments} active`, color: "purple" } : undefined}
          />
          <QuickLinkCard
            title="Customer Scores"
            description="CLV, engagement scores, and churn risk"
            to="/ad-planning/scores"
          />
          <QuickLinkCard
            title="Attribution"
            description="Campaign attribution analysis and insights"
            to="/ad-planning/attribution"
          />
        </div>
      </div>
      <Outlet />
    </>
  )
}

export const config = defineRouteConfig({
  label: "Ad Planning",
  icon: ChartBar,
})

export default AdPlanningDashboard
