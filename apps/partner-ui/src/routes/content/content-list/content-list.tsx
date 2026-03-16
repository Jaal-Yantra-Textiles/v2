import { Container, Heading, Text, Button, Badge, toast } from "@medusajs/ui"
import { PlusMini } from "@medusajs/icons"
import { useNavigate } from "react-router-dom"
import {
  usePartnerWebsite,
  useCreatePartnerWebsite,
  useContentPages,
} from "../../../hooks/api/content"
import { usePartnerStores } from "../../../hooks/api/partner-stores"
import { useStorefrontStatus } from "../../../hooks/api/storefront"

export const ContentList = () => {
  const navigate = useNavigate()

  // 1. Check store
  const { stores, isPending: storesLoading } = usePartnerStores()
  const hasStore = stores.length > 0

  // 2. Check storefront provisioning
  const { data: storefrontStatus, isPending: statusLoading } =
    useStorefrontStatus({ enabled: hasStore })
  const isProvisioned = !!storefrontStatus?.provisioned
  const storefrontDomain = storefrontStatus?.domain

  // 3. Check website
  const { website, isPending: websiteLoading } = usePartnerWebsite({
    enabled: isProvisioned,
  })

  // 4. List pages (exclude Blog)
  const { pages, count, isPending: pagesLoading } = useContentPages(
    { limit: 50 },
    { enabled: !!website }
  )
  // Filter out Blog pages client-side
  const contentPages = pages.filter(
    (p: any) => p.page_type !== "Blog"
  )

  const { mutateAsync: createWebsite, isPending: isCreating } =
    useCreatePartnerWebsite()

  const handleCreatePages = async () => {
    try {
      await createWebsite()
      toast.success("Pages created successfully")
    } catch (e: any) {
      toast.error(e?.message || "Failed to create pages")
    }
  }

  const isLoading = storesLoading || statusLoading

  // Step 1: No store
  if (!isLoading && !hasStore) {
    return (
      <div className="flex flex-col gap-y-3">
        <Container className="p-8 text-center">
          <Heading level="h1" className="mb-2">
            Content
          </Heading>
          <Text className="text-ui-fg-subtle mb-6">
            Create a store first to manage your storefront content.
          </Text>
          <Button onClick={() => navigate("/create-store")}>
            Create Store
          </Button>
        </Container>
      </div>
    )
  }

  // Step 2: Store exists but storefront not provisioned
  if (!isLoading && !statusLoading && !isProvisioned) {
    return (
      <div className="flex flex-col gap-y-3">
        <Container className="p-8 text-center">
          <Heading level="h1" className="mb-2">
            Content
          </Heading>
          <Text className="text-ui-fg-subtle mb-6">
            Enable your storefront to start managing pages. Go to Settings to
            provision your storefront.
          </Text>
          <Button onClick={() => navigate("/settings/store")}>
            Enable Storefront
          </Button>
        </Container>
      </div>
    )
  }

  // Step 3: Provisioned but no website/pages yet
  if (!isLoading && !websiteLoading && !website) {
    return (
      <div className="flex flex-col gap-y-3">
        <Container className="p-8 text-center">
          <Heading level="h1" className="mb-2">
            Content
          </Heading>
          <Text className="text-ui-fg-subtle mb-4">
            Your storefront is live at{" "}
            <span className="font-medium text-ui-fg-base">
              {storefrontDomain}
            </span>
          </Text>
          <Text className="text-ui-fg-subtle mb-6">
            Create your default pages (Terms & Conditions, Privacy Policy,
            Contact) to get started.
          </Text>
          <Button onClick={handleCreatePages} disabled={isCreating}>
            <PlusMini className="mr-1.5" />
            {isCreating ? "Creating..." : "Create Pages"}
          </Button>
        </Container>
      </div>
    )
  }

  // Loading
  if (isLoading || websiteLoading || pagesLoading) {
    return (
      <div className="flex flex-col gap-y-3">
        <Container className="p-8 text-center">
          <Text className="text-ui-fg-subtle">Loading...</Text>
        </Container>
      </div>
    )
  }

  // Step 4: Pages list
  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h1">Content</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {storefrontDomain}
            </Text>
          </div>
        </div>

        {contentPages.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <Text className="text-ui-fg-subtle">
              No pages yet.
            </Text>
          </div>
        ) : (
          <div className="divide-y">
            {contentPages.map((page: any) => (
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
                <Badge color="grey" size="2xsmall">
                  {page.page_type}
                </Badge>
              </button>
            ))}
          </div>
        )}

        {contentPages.length > 0 && (
          <div className="px-6 py-3">
            <Text size="xsmall" className="text-ui-fg-muted">
              {contentPages.length}{" "}
              {contentPages.length === 1 ? "page" : "pages"}
            </Text>
          </div>
        )}
      </Container>
    </div>
  )
}
