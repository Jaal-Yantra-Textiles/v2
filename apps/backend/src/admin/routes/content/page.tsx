import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText } from "@medusajs/icons"
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

export default function ContentHub() {
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading>Content</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Stuff we publish — marketing websites and social posts that drive
          traffic to them.
        </Text>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <QuickLinkCard
            title="Websites"
            description="Marketing storefronts, pages, blog posts, and analytics."
            to="/websites"
          />
          <QuickLinkCard
            title="Social Posts"
            description="Outgoing posts across connected social platforms."
            to="/social-posts"
          />
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Content",
  icon: DocumentText,
})

export const handle = {
  breadcrumb: () => "Content",
}
