import { Container, Heading, Text, Button, Badge, toast } from "@medusajs/ui"
import { PlusMini, ArrowPath } from "@medusajs/icons"
import { useNavigate } from "react-router-dom"
import { Container as PageContainer } from "@medusajs/ui"
import {
  usePartnerWebsite,
  useCreatePartnerWebsite,
  useContentPages,
  useSeedContentPages,
} from "../../../hooks/api/content"
import { useStorefrontStatus } from "../../../hooks/api/storefront"

export const ContentList = () => {
  const navigate = useNavigate()
  const { data: storefrontStatus, isPending: statusLoading } =
    useStorefrontStatus()
  const { website, isPending: websiteLoading } = usePartnerWebsite({
    enabled: !!storefrontStatus?.provisioned,
  })
  const { pages, count, isPending: pagesLoading } = useContentPages(
    { limit: 50 },
    { enabled: !!website }
  )
  const { mutateAsync: createWebsite, isPending: isCreating } =
    useCreatePartnerWebsite()
  const { mutateAsync: seedPages, isPending: isSeeding } =
    useSeedContentPages()

  const isLoading = statusLoading || websiteLoading

  const handleSetupWebsite = async () => {
    try {
      await createWebsite()
      toast.success("Website created with default pages")
    } catch (e: any) {
      toast.error(e?.message || "Failed to create website")
    }
  }

  const handleSeedPages = async () => {
    try {
      const result = await seedPages()
      toast.success(
        `Added ${result.pages?.length || 0} pages, skipped ${result.skipped?.length || 0}`
      )
    } catch (e: any) {
      toast.error(e?.message || "Failed to seed pages")
    }
  }

  // Not provisioned
  if (!isLoading && !storefrontStatus?.provisioned) {
    return (
      <div className="flex flex-col gap-y-3">
        <Container className="p-8 text-center">
          <Heading level="h1" className="mb-2">
            Content
          </Heading>
          <Text className="text-ui-fg-subtle mb-6">
            Provision your storefront first to manage pages and content.
          </Text>
          <Button variant="secondary" onClick={() => navigate("/settings")}>
            Go to Settings
          </Button>
        </Container>
      </div>
    )
  }

  // No website yet
  if (!isLoading && !websiteLoading && !website) {
    return (
      <div className="flex flex-col gap-y-3">
        <Container className="p-8 text-center">
          <Heading level="h1" className="mb-2">
            Content
          </Heading>
          <Text className="text-ui-fg-subtle mb-6">
            Set up your website to start managing pages, blog posts, and
            storefront content.
          </Text>
          <Button onClick={handleSetupWebsite} disabled={isCreating}>
            {isCreating ? "Setting up..." : "Set Up Website"}
          </Button>
        </Container>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h1">Content</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Manage your storefront pages and content
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <Button
              variant="secondary"
              size="small"
              onClick={handleSeedPages}
              disabled={isSeeding}
            >
              <ArrowPath className="mr-1.5" />
              {isSeeding ? "Seeding..." : "Add Default Pages"}
            </Button>
          </div>
        </div>

        {/* Pages list */}
        {pagesLoading ? (
          <div className="px-6 py-8 text-center">
            <Text className="text-ui-fg-subtle">Loading pages...</Text>
          </div>
        ) : pages.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <Text className="text-ui-fg-subtle mb-4">
              No pages yet. Add default pages to get started.
            </Text>
          </div>
        ) : (
          <div className="divide-y">
            {pages.map((page: any) => (
              <button
                key={page.id}
                onClick={() => navigate(`/content/${page.id}`)}
                className="flex items-center justify-between w-full px-6 py-4 text-left hover:bg-ui-bg-subtle transition-colors"
              >
                <div className="flex flex-col gap-y-1">
                  <div className="flex items-center gap-x-2">
                    <Text weight="plus">{page.title}</Text>
                    <Badge
                      color={
                        page.status === "Published"
                          ? "green"
                          : page.status === "Draft"
                            ? "orange"
                            : "grey"
                      }
                      size="2xsmall"
                    >
                      {page.status}
                    </Badge>
                  </div>
                  <Text size="small" className="text-ui-fg-subtle">
                    /{page.slug}
                  </Text>
                </div>
                <div className="flex items-center gap-x-3">
                  <Badge color="grey" size="2xsmall">
                    {page.page_type}
                  </Badge>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {page.blocks?.length || 0} blocks
                  </Text>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Footer */}
        {count > 0 && (
          <div className="px-6 py-3">
            <Text size="xsmall" className="text-ui-fg-muted">
              {count} {count === 1 ? "page" : "pages"}
            </Text>
          </div>
        )}
      </Container>
    </div>
  )
}
