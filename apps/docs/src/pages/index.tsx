import type { ReactNode } from "react"
import Link from "@docusaurus/Link"
import useDocusaurusContext from "@docusaurus/useDocusaurusContext"
import Layout from "@theme/Layout"
import { Badge, Text, Heading as MedusaHeading } from "@medusajs/ui"
import {
  BookOpen,
  CogSixTooth,
  DocumentText,
  ArrowRight,
} from "@medusajs/icons"

const sections = [
  {
    title: "Guides",
    description:
      "Step-by-step instructions for ad planning, social media, analytics, deployment, and more.",
    href: "/docs/guides/intro",
    icon: BookOpen,
    badge: "End Users",
    badgeColor: "green" as const,
  },
  {
    title: "Implementation",
    description:
      "Architecture decisions, module internals, AI integration, and workflow documentation.",
    href: "/docs/implementation/intro",
    icon: CogSixTooth,
    badge: "Dev Team",
    badgeColor: "blue" as const,
  },
  {
    title: "Reference",
    description:
      "API references, platform configs, troubleshooting guides, and status reports.",
    href: "/docs/reference/intro",
    icon: DocumentText,
    badge: "Both",
    badgeColor: "purple" as const,
  },
]

function SectionCard({
  title,
  description,
  href,
  icon: Icon,
  badge,
  badgeColor,
}: (typeof sections)[0]) {
  return (
    <Link to={href} className="no-underline hover:no-underline group">
      <div className="rounded-xl border border-solid border-ui-border-base bg-ui-bg-base p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:border-ui-border-interactive h-full">
        <div className="flex items-center gap-3 mb-3">
          <div className="rounded-lg bg-ui-bg-field p-2">
            <Icon className="text-ui-fg-subtle" />
          </div>
          <Badge color={badgeColor} size="small">
            {badge}
          </Badge>
        </div>
        <Text size="large" weight="plus" className="mb-2 block text-ui-fg-base">
          {title}
        </Text>
        <Text size="small" className="text-ui-fg-subtle mb-4 block">
          {description}
        </Text>
        <div className="flex items-center gap-1 text-ui-fg-interactive">
          <Text size="small" weight="plus">
            Browse {title}
          </Text>
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  )
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext()
  return (
    <Layout title="Home" description={siteConfig.tagline}>
      <div className="bg-ui-bg-base min-h-screen">
        {/* Hero */}
        <header className="py-16 md:py-24 text-center">
          <div className="container mx-auto px-4 max-w-3xl">
            <Badge color="purple" size="small" className="mb-4">
              Medusa 2.x Platform
            </Badge>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-ui-fg-base mb-4">
              {siteConfig.title}
            </h1>
            <Text size="large" className="text-ui-fg-subtle max-w-2xl mx-auto block">
              {siteConfig.tagline}
            </Text>
            <div className="flex gap-3 justify-center mt-8">
              <Link
                className="inline-flex items-center gap-2 rounded-lg bg-ui-button-inverted px-5 py-2.5 text-sm font-medium text-ui-fg-on-inverted no-underline hover:no-underline hover:opacity-90 transition-opacity"
                to="/docs/guides/intro"
              >
                Get Started
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </header>

        {/* Section cards */}
        <main className="container mx-auto px-4 pb-16 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {sections.map((section) => (
              <SectionCard key={section.title} {...section} />
            ))}
          </div>
        </main>
      </div>
    </Layout>
  )
}
