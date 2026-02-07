/**
 * Ad Planning Dashboard - Quick Navigation
 * Landing page with links to all ad-planning modules and a metrics overview modal
 */

import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { Container, Heading, Text, Button } from "@medusajs/ui"
import { Link, Outlet } from "react-router-dom"

const QuickLinkCard = ({
  title,
  description,
  to,
}: {
  title: string
  description: string
  to: string
}) => (
  <Link
    to={to}
    className="block outline-none focus:shadow-borders-interactive-with-focus rounded-lg"
  >
    <div className="shadow-elevation-card-rest bg-ui-bg-component hover:bg-ui-bg-component-hover rounded-lg p-5 transition-colors">
      <Text size="base" leading="compact" weight="plus">
        {title}
      </Text>
      <Text size="small" leading="compact" className="text-ui-fg-subtle mt-1">
        {description}
      </Text>
    </div>
  </Link>
)

const AdPlanningDashboard = () => {
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

        {/* Quick Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <QuickLinkCard
            title="Conversions"
            description="Track and analyze conversion events"
            to="/ad-planning/conversions"
          />
          <QuickLinkCard
            title="A/B Experiments"
            description="Create and manage A/B tests"
            to="/ad-planning/experiments"
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
