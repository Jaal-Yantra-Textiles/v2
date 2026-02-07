/**
 * Ad Planning Dashboard - Main Overview Page
 * Displays key metrics, live stats, and quick access to all features
 */

import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { Container, Heading, Text, Badge } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { sdk } from "../../lib/config"

// Metric Card Component
const MetricCard = ({
  title,
  value,
  change,
  changeType = "neutral",
  subtitle,
}: {
  title: string
  value: string | number
  change?: string
  changeType?: "positive" | "negative" | "neutral"
  subtitle?: string
}) => {
  const changeColor = {
    positive: "text-ui-fg-positive",
    negative: "text-ui-fg-error",
    neutral: "text-ui-fg-subtle",
  }[changeType]

  return (
    <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-6">
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        {title}
      </Text>
      <div className="mt-2 flex items-baseline gap-2">
        <Text size="xlarge" leading="compact" weight="plus">
          {value}
        </Text>
        {change && (
          <Text size="small" leading="compact" className={changeColor}>
            {change}
          </Text>
        )}
      </div>
      {subtitle && (
        <Text size="xsmall" leading="compact" className="text-ui-fg-muted mt-1">
          {subtitle}
        </Text>
      )}
    </div>
  )
}

// Quick Link Card Component - uses Link for navigation
const QuickLinkCard = ({
  title,
  description,
  to,
  count,
}: {
  title: string
  description: string
  to: string
  count?: number
}) => {
  return (
    <Link
      to={to}
      className="block outline-none focus:shadow-borders-interactive-with-focus rounded-lg"
    >
      <div className="shadow-elevation-card-rest bg-ui-bg-component hover:bg-ui-bg-component-hover rounded-lg p-5 transition-colors">
        <div className="flex items-center justify-between">
          <Text size="base" leading="compact" weight="plus">
            {title}
          </Text>
          {count !== undefined && (
            <Badge color="grey" size="xsmall">
              {count}
            </Badge>
          )}
        </div>
        <Text size="small" leading="compact" className="text-ui-fg-subtle mt-1">
          {description}
        </Text>
      </div>
    </Link>
  )
}

const AdPlanningDashboard = () => {
  // Fetch overview stats
  const { data: conversionStats } = useQuery({
    queryKey: ["ad-planning", "conversions", "stats"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/conversions/stats")
      return res
    },
  })

  const { data: experimentsData } = useQuery({
    queryKey: ["ad-planning", "experiments"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/experiments?limit=5")
      return res
    },
  })

  const { data: segmentsData } = useQuery({
    queryKey: ["ad-planning", "segments"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/segments?limit=5")
      return res
    },
  })

  const { data: journeyStats } = useQuery({
    queryKey: ["ad-planning", "journeys", "funnel"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/journeys/funnel")
      return res
    },
  })

  // Calculate metrics
  const totalConversions = conversionStats?.total_conversions || 0
  const totalRevenue = conversionStats?.total_value || 0
  const conversionRate = conversionStats?.conversion_rate || 0
  const activeExperiments = experimentsData?.experiments?.filter(
    (e: any) => e.status === "running"
  ).length || 0
  const totalSegments = segmentsData?.count || 0

  return (
    <div className="flex flex-col gap-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">Ad Planning & Attribution</Heading>
          <Text size="small" leading="compact" className="text-ui-fg-subtle mt-1">
            Track conversions, run experiments, and understand your customers
          </Text>
        </div>
      </div>

      {/* Key Metrics */}
      <div>
        <Text size="small" leading="compact" weight="plus" className="mb-3">
          Key Metrics
        </Text>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Total Conversions"
            value={totalConversions.toLocaleString()}
            subtitle="All time"
          />
          <MetricCard
            title="Total Revenue"
            value={`₹${(totalRevenue / 100).toLocaleString()}`}
            subtitle="From tracked conversions"
          />
          <MetricCard
            title="Conversion Rate"
            value={`${(conversionRate * 100).toFixed(2)}%`}
            subtitle="Average across campaigns"
          />
          <MetricCard
            title="Active Experiments"
            value={activeExperiments}
            subtitle="Running A/B tests"
          />
        </div>
      </div>

      {/* Funnel Overview */}
      {journeyStats?.funnel && (
        <Container className="p-0">
          <div className="px-6 py-4 border-b border-ui-border-base">
            <Text size="small" leading="compact" weight="plus">
              Customer Funnel Overview
            </Text>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center gap-2">
              {journeyStats.funnel.map((stage: any, index: number) => (
                <div key={stage.stage} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <Text size="xsmall" leading="compact" className="text-ui-fg-subtle capitalize">
                      {stage.stage}
                    </Text>
                    <Text size="base" leading="compact" weight="plus">
                      {stage.count.toLocaleString()}
                    </Text>
                  </div>
                  {index < journeyStats.funnel.length - 1 && (
                    <div className="mx-4 text-ui-fg-muted">→</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Container>
      )}

      {/* Quick Links */}
      <div>
        <Text size="small" leading="compact" weight="plus" className="mb-3">
          Quick Access
        </Text>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <QuickLinkCard
            title="Conversions"
            description="Track and analyze conversion events"
            to="/ad-planning/conversions"
            count={totalConversions}
          />
          <QuickLinkCard
            title="A/B Experiments"
            description="Create and manage A/B tests"
            to="/ad-planning/experiments"
            count={experimentsData?.count || 0}
          />
          <QuickLinkCard
            title="Customer Journeys"
            description="Visualize customer touchpoints"
            to="/ad-planning/journeys"
          />
          <QuickLinkCard
            title="Customer Segments"
            description="Create and manage audience segments"
            to="/ad-planning/segments"
            count={totalSegments}
          />
          <QuickLinkCard
            title="Customer Scores"
            description="CLV, engagement, and churn risk"
            to="/ad-planning/scores"
          />
          <QuickLinkCard
            title="Attribution"
            description="Campaign attribution analysis"
            to="/ad-planning/attribution"
          />
        </div>
      </div>

      {/* Recent Experiments */}
      {experimentsData?.experiments?.length > 0 && (
        <Container className="p-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border-base">
            <Text size="small" leading="compact" weight="plus">
              Recent Experiments
            </Text>
            <Link to="/ad-planning/experiments" className="hover:underline">
              <Text size="small" leading="compact" className="text-ui-fg-interactive">
                View all
              </Text>
            </Link>
          </div>
          <div className="divide-y divide-ui-border-base">
            {experimentsData.experiments.slice(0, 5).map((exp: any) => (
              <Link
                key={exp.id}
                to={`/ad-planning/experiments/${exp.id}`}
                className="block px-6 py-4 hover:bg-ui-bg-base-hover transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <Text size="small" leading="compact" weight="plus">
                      {exp.name}
                    </Text>
                    <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
                      {exp.primary_metric}
                    </Text>
                  </div>
                  <Badge
                    color={
                      exp.status === "running"
                        ? "green"
                        : exp.status === "completed"
                        ? "blue"
                        : "grey"
                    }
                    size="xsmall"
                  >
                    {exp.status}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        </Container>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Ad Planning",
  icon: ChartBar,
})

export default AdPlanningDashboard
