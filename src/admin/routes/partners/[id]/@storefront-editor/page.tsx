import { useParams, useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { usePartner } from "../../../../hooks/api/partners-admin"
import { useWebsites } from "../../../../hooks/api/websites"
import { usePages, useUpdatePage } from "../../../../hooks/api/pages"
import { useBlocks } from "../../../../hooks/api/blocks"
import { VisualPageEditor } from "../../../../components/visual-editor/visual-page-editor"
import { Text, Button, Badge, Select, toast } from "@medusajs/ui"
import { PencilSquare, EyeMini, EyeSlash } from "@medusajs/icons"

const StorefrontEditorPage = () => {
  const { id: partnerId } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // Fetch partner to get storefront domain
  const { partner, isPending: partnerLoading } = usePartner(partnerId!, ["*"]) as any

  const domain = partner?.metadata?.storefront_domain

  // Find website by domain
  const { websites, isPending: websitesLoading } = useWebsites(
    domain ? { domain } : undefined,
    { enabled: !!domain }
  )

  const website = websites?.[0]

  // List pages for the website
  const { pages, isPending: pagesLoading } = usePages(
    website?.id || "",
    { limit: 50 },
    { enabled: !!website?.id }
  )

  // Page selection state
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)

  // Auto-select first page
  useEffect(() => {
    if (pages?.length && !selectedPageId) {
      setSelectedPageId(pages[0].id)
    }
  }, [pages, selectedPageId])

  const selectedPage = pages?.find((p: any) => p.id === selectedPageId)

  // Fetch blocks for selected page
  const { blocks, isPending: blocksLoading } = useBlocks(
    website?.id || "",
    selectedPageId || "",
    undefined,
    { enabled: !!website?.id && !!selectedPageId }
  )

  // Publish/Draft toggle
  const { mutateAsync: updatePage, isPending: isUpdatingPage } = useUpdatePage(
    website?.id || "",
    selectedPageId || ""
  )

  const handleToggleStatus = async () => {
    if (!selectedPage) return

    const newStatus = selectedPage.status === "Published" ? "Draft" : "Published"
    try {
      await updatePage({
        status: newStatus,
        ...(newStatus === "Published" ? { published_at: new Date().toISOString() } : {}),
      })
      toast.success(`Page ${newStatus === "Published" ? "published" : "unpublished"}`)
    } catch (e: any) {
      toast.error(`Failed to update status: ${e?.message || "Unknown error"}`)
    }
  }

  const isLoading = partnerLoading || websitesLoading

  // Not provisioned
  if (!isLoading && !domain) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header>
          <Text weight="plus">Storefront Editor</Text>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex items-center justify-center">
          <div className="text-center space-y-3">
            <Text className="text-ui-fg-subtle">
              This partner's storefront has not been provisioned yet.
            </Text>
            <Button variant="secondary" onClick={() => navigate(`/partners/${partnerId}`)}>
              Go Back
            </Button>
          </div>
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  // No website found
  if (!isLoading && !websitesLoading && !website) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header>
          <Text weight="plus">Storefront Editor</Text>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex items-center justify-center">
          <div className="text-center space-y-3">
            <Text className="text-ui-fg-subtle">
              No website found for domain <strong>{domain}</strong>.
              Create one from the Websites section first.
            </Text>
            <Button variant="secondary" onClick={() => navigate(`/partners/${partnerId}`)}>
              Go Back
            </Button>
          </div>
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  // Loading state
  if (isLoading || pagesLoading || !selectedPage) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header>
          <Text weight="plus">Storefront Editor</Text>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex items-center justify-center">
          <Text className="text-ui-fg-subtle">Loading editor...</Text>
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  const isPublished = selectedPage.status === "Published"

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center gap-x-3 w-full">
          <PencilSquare className="text-ui-fg-muted" />
          <Text weight="plus">{partner?.name || "Partner"}</Text>
          <Text className="text-ui-fg-subtle">—</Text>

          {/* Page selector */}
          <div className="flex items-center gap-x-2">
            <Select
              value={selectedPageId || ""}
              onValueChange={(value) => setSelectedPageId(value)}
            >
              <Select.Trigger className="min-w-[200px]">
                <Select.Value placeholder="Select a page" />
              </Select.Trigger>
              <Select.Content>
                {(pages || []).map((p: any) => (
                  <Select.Item key={p.id} value={p.id}>
                    <div className="flex items-center gap-x-2">
                      <span>{p.title}</span>
                      <Badge
                        color={p.status === "Published" ? "green" : p.status === "Draft" ? "orange" : "grey"}
                        size="2xsmall"
                      >
                        {p.status}
                      </Badge>
                    </div>
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          <Badge color="blue" size="2xsmall">
            {domain}
          </Badge>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Publish/Draft toggle */}
          <Button
            variant={isPublished ? "secondary" : "primary"}
            size="small"
            onClick={handleToggleStatus}
            disabled={isUpdatingPage}
          >
            {isPublished ? (
              <>
                <EyeSlash className="mr-1.5" />
                Unpublish
              </>
            ) : (
              <>
                <EyeMini className="mr-1.5" />
                Publish
              </>
            )}
          </Button>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="p-0 h-[calc(100vh-120px)]">
        {blocksLoading ? (
          <div className="flex items-center justify-center h-full">
            <Text className="text-ui-fg-subtle">Loading blocks...</Text>
          </div>
        ) : (
          <VisualPageEditor
            key={selectedPageId}
            websiteId={website!.id}
            pageId={selectedPageId!}
            page={selectedPage}
            blocks={blocks || []}
            domain={domain}
          />
        )}
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default StorefrontEditorPage
