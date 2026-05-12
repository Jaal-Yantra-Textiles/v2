import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CogSixTooth } from "@medusajs/icons"
import { Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

/**
 * Operations hub — a single sidebar entry that gathers the back-office
 * routes operators only open occasionally (reports + admin tools). Mirrors
 * the pattern already used inside `/admin/ad-planning`: parent route with
 * its own `defineRouteConfig`, sub-routes left at their existing URLs so
 * deep-links / `navigate()` calls keep working, navigation surfaced via
 * QuickLinkCards on this page.
 *
 * Adding a new hub member is a two-line change: add a card here, and
 * remove `export const config = defineRouteConfig(...)` from the target's
 * `page.tsx` so it stops showing as its own sidebar entry.
 */

type CardProps = {
  title: string
  description: string
  to: string
}

const QuickLinkCard = ({ title, description, to }: CardProps) => (
  <Link
    to={to}
    className="block h-full outline-none focus:shadow-borders-interactive-with-focus rounded-lg"
  >
    <div className="shadow-elevation-card-rest bg-ui-bg-component hover:bg-ui-bg-component-hover rounded-lg p-5 transition-colors h-full flex flex-col min-h-[110px]">
      <Text size="base" leading="compact" weight="plus">
        {title}
      </Text>
      <Text size="small" leading="compact" className="text-ui-fg-subtle mt-1 flex-1">
        {description}
      </Text>
    </div>
  </Link>
)

const Section = ({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) => (
  <div className="px-6 py-6">
    <Heading level="h2">{title}</Heading>
    <Text className="text-ui-fg-subtle mt-1" size="small">
      {description}
    </Text>
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {children}
    </div>
  </div>
)

export default function OperationsHub() {
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading>Operations</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Reports and admin tools — the routes you don't need front-and-center
          but want one click away.
        </Text>
      </div>

      <Section
        title="Reporting"
        description="Numbers across the platform — ads attribution, store stats, payment audit trails."
      >
        <QuickLinkCard
          title="Ad Planning"
          description="Goals, experiments, conversion attribution, audience segments."
          to="/ad-planning"
        />
        <QuickLinkCard
          title="Stats"
          description="Platform-wide aggregates and trends."
          to="/stats"
        />
        <QuickLinkCard
          title="Payment Reports"
          description="Saved reports + live summaries, broken down by partner or person."
          to="/payment-reports"
        />
        <QuickLinkCard
          title="Payment Submissions"
          description="Submissions queue + reconciliation workflow."
          to="/payment-submissions"
        />
      </Section>

      <Section
        title="Tools"
        description="Workflow editors and media management."
      >
        <QuickLinkCard
          title="Visual Flows"
          description="Workflow builder — triggers, schedules, and event-driven pipelines."
          to="/visual-flows"
        />
        <QuickLinkCard
          title="Medias"
          description="Media folders, uploads, and shared assets."
          to="/medias"
        />
      </Section>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Operations",
  icon: CogSixTooth,
})

export const handle = {
  breadcrumb: () => "Operations",
}
