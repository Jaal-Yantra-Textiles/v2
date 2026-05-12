import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ToolsSolid } from "@medusajs/icons"
import { Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

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

export default function ProductionHub() {
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading>Production</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          What we're making and who's making it — designs, production runs, and
          the partner network.
        </Text>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <QuickLinkCard
            title="Designs"
            description="Catalog of designs across collections."
            to="/designs"
          />
          <QuickLinkCard
            title="Production Runs"
            description="Active and historical runs, batches, and dispatch state."
            to="/production-runs"
          />
          <QuickLinkCard
            title="Partners"
            description="Studios, ateliers, and makers we manufacture with."
            to="/partners"
          />
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Production",
  icon: ToolsSolid,
})

export const handle = {
  breadcrumb: () => "Production",
}
