import { 
  Container, 
  Heading, 
  Text, 
  StatusBadge, 
  Button,
  toast,
  usePrompt,
  Avatar,
  InlineTip,
} from "@medusajs/ui"
import { useParams, useNavigate, useLoaderData, UIMatch, LoaderFunctionArgs } from "react-router-dom"
import { 
  useCampaign, 
  useStartCampaign, 
  usePauseCampaign, 
  useCancelCampaign,
  usePreviewCampaign,
  useDeleteCampaign,
  useRetryCampaignItem,
  useRetryAllFailedItems,
  Campaign,
  CampaignItem,
} from "../../../hooks/api/publishing-campaigns"
import { useProducts } from "../../../hooks/api/products"
import { 
  ArrowPath, 
  PauseSolid, 
  PlaySolid, 
  XCircleSolid,
  Trash,
  EyeMini,
  CheckCircleSolid,
  ArrowPathMini,
  PencilSquare,
} from "@medusajs/icons"
import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import { ActionMenu } from "../../../components/common/action-menu"
import { Thumbnail } from "../../../components/common/thumbnail"
import { useMemo } from "react"
import { campaignLoader } from "./loader"

// ============ Helper Functions ============

const getCampaignStatusColor = (status: Campaign["status"]): "green" | "orange" | "blue" | "red" | "grey" | "purple" => {
  switch (status) {
    case "active": return "green"
    case "paused": return "orange"
    case "completed": return "blue"
    case "cancelled": return "red"
    case "draft": return "grey"
    case "preview": return "purple"
    default: return "grey"
  }
}

const getItemStatusColor = (status: CampaignItem["status"]): "green" | "orange" | "blue" | "red" | "grey" => {
  switch (status) {
    case "published": return "green"
    case "failed": return "red"
    case "publishing": return "blue"
    case "skipped": return "grey"
    case "pending": return "orange"
    default: return "grey"
  }
}

// ============ Section Components ============

type CampaignGeneralSectionProps = {
  campaign: Campaign
  onStart: () => void
  onPause: () => void
  onCancel: () => void
  onPreview: () => void
  onDelete: () => void
  isStarting: boolean
  isPausing: boolean
  isPreviewing: boolean
}

const CampaignGeneralSection = ({ 
  campaign, 
  onStart, 
  onPause, 
  onCancel, 
  onPreview, 
  onDelete,
  isStarting,
  isPausing,
  isPreviewing,
}: CampaignGeneralSectionProps) => {
  const prompt = usePrompt()
  
  const canStart = ["draft", "preview", "paused"].includes(campaign.status)
  const canPause = campaign.status === "active"
  const canCancel = ["active", "paused", "draft", "preview"].includes(campaign.status)
  const canDelete = campaign.status !== "active"
  const canPreview = ["draft", "preview"].includes(campaign.status)
  const canEdit = ["draft", "paused"].includes(campaign.status)
  
  const handleDelete = async () => {
    const confirmed = await prompt({
      title: "Delete Campaign",
      description: "Are you sure you want to delete this campaign? This action cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (confirmed) {
      onDelete()
    }
  }
  
  const handleCancel = async () => {
    const confirmed = await prompt({
      title: "Cancel Campaign",
      description: "Are you sure you want to cancel this campaign? All pending items will be skipped.",
      confirmText: "Cancel Campaign",
      cancelText: "Keep Running",
    })
    if (confirmed) {
      onCancel()
    }
  }
  
  return (
    <Container className="divide-y p-0">
      {/* Header with actions */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Avatar
            src={undefined}
            fallback={campaign.name.charAt(0).toUpperCase()}
          />
          <div>
            <div className="flex items-center gap-2">
              <Heading>{campaign.name}</Heading>
              <StatusBadge color={getCampaignStatusColor(campaign.status)}>
                {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
              </StatusBadge>
            </div>
          </div>
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                ...(canEdit ? [{
                  label: "Edit",
                  icon: <PencilSquare />,
                  to: "edit",
                }] : []),
                ...(canPreview ? [{
                  label: "Preview",
                  icon: <EyeMini />,
                  onClick: onPreview,
                  disabled: isPreviewing,
                }] : []),
                ...(canStart ? [{
                  label: campaign.status === "paused" ? "Resume" : "Start",
                  icon: <PlaySolid />,
                  onClick: onStart,
                  disabled: isStarting,
                }] : []),
                ...(canPause ? [{
                  label: "Pause",
                  icon: <PauseSolid />,
                  onClick: onPause,
                  disabled: isPausing,
                }] : []),
              ],
            },
            {
              actions: [
                ...(canCancel ? [{
                  label: "Cancel Campaign",
                  icon: <XCircleSolid />,
                  onClick: handleCancel,
                }] : []),
                ...(canDelete ? [{
                  label: "Delete",
                  icon: <Trash />,
                  onClick: handleDelete,
                }] : []),
              ],
            },
          ]}
        />
      </div>
      
      {/* Details Grid */}
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">Platform</Text>
        <Text size="small" leading="compact">{campaign.platform?.name || "—"}</Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">Interval</Text>
        <Text size="small" leading="compact">{campaign.interval_hours} hours</Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">Total Items</Text>
        <Text size="small" leading="compact">{campaign.items?.length || 0}</Text>
      </div>
      {campaign.next_publish_at && campaign.status === "active" && (
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">Next Publish</Text>
          <Text size="small" leading="compact">
            {new Date(campaign.next_publish_at).toLocaleString()}
          </Text>
        </div>
      )}
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">Created</Text>
        <Text size="small" leading="compact">
          {new Date(campaign.created_at).toLocaleDateString()}
        </Text>
      </div>
    </Container>
  )
}

type CampaignItemsSectionProps = {
  campaign: Campaign
}

const CampaignItemsSection = ({ campaign }: CampaignItemsSectionProps) => {
  const navigate = useNavigate()
  const items = campaign.items || []
  const retryMutation = useRetryCampaignItem()
  
  // Fetch products to get names and thumbnails
  const productIds = useMemo(() => items.map(item => item.product_id), [items])
  const { products } = useProducts(
    { id: productIds, limit: 100 },
    { enabled: productIds.length > 0 }
  )
  
  // Create a map of product_id -> product for quick lookup
  const productMap = useMemo(() => {
    const map = new Map<string, { title: string; thumbnail?: string }>()
    if (products) {
      for (const product of products) {
        map.set(product.id, { 
          title: product.title || "Untitled Product", 
          thumbnail: product.thumbnail || undefined 
        })
      }
    }
    return map
  }, [products])
  
  const handleRetry = async (index: number, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent navigation
    try {
      await retryMutation.mutateAsync({ id: campaign.id, item_index: index })
      toast.success("Item retry started")
    } catch (error: any) {
      toast.error(error.message || "Failed to retry item")
    }
  }
  
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Campaign Items</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {items.length} products
        </Text>
      </div>
      
      {items.length === 0 ? (
        <div className="px-6 py-8 text-center">
          <Text className="text-ui-fg-subtle">No items in this campaign</Text>
        </div>
      ) : (
        items.map((item, index) => {
          const product = productMap.get(item.product_id)
          const isRetrying = retryMutation.isPending && retryMutation.variables?.item_index === index
          
          return (
            <div 
              key={index}
              className="flex items-center gap-4 px-6 py-4 hover:bg-ui-bg-subtle-hover cursor-pointer"
              onClick={() => item.social_post_id && navigate(`/social-posts/${item.social_post_id}`)}
            >
              {/* Thumbnail or Index */}
              <Thumbnail 
                src={product?.thumbnail} 
                alt={product?.title}
                size="large"
              />
              
              {/* Product Info */}
              <div className="flex-1 min-w-0">
                <Text className="font-medium truncate">
                  {product?.title || item.product_id}
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {new Date(item.scheduled_at).toLocaleString()}
                </Text>
                {item.error_message && (
                  <div className="mt-1">
                    <InlineTip variant="error" label="Error">
                      {item.error_message}
                    </InlineTip>
                  </div>
                )}
              </div>
              
              {/* Retry Button for Failed Items */}
              {item.status === "failed" && (
                <Button
                  variant="secondary"
                  size="small"
                  onClick={(e) => handleRetry(index, e)}
                  isLoading={isRetrying}
                  disabled={isRetrying}
                >
                  <ArrowPathMini className="mr-1" />
                  Retry
                </Button>
              )}
              
              {/* Status */}
              <StatusBadge color={getItemStatusColor(item.status)}>
                {item.status}
              </StatusBadge>
            </div>
          )
        })
      )}
    </Container>
  )
}

type CampaignStatsSectionProps = {
  campaign: Campaign
}

const CampaignStatsSection = ({ campaign }: CampaignStatsSectionProps) => {
  const stats = campaign.stats
  
  if (!stats) return null
  
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Statistics</Heading>
      </div>
      
      <div className="grid grid-cols-2 gap-4 p-6">
        <div className="text-center p-4 bg-ui-bg-subtle rounded-lg">
          <Text className="text-2xl font-bold">{stats.total}</Text>
          <Text size="small" className="text-ui-fg-subtle">Total</Text>
        </div>
        <div className="text-center p-4 bg-ui-bg-subtle rounded-lg">
          <Text className="text-2xl font-bold text-ui-fg-interactive">{stats.published}</Text>
          <Text size="small" className="text-ui-fg-subtle">Published</Text>
        </div>
        <div className="text-center p-4 bg-ui-bg-subtle rounded-lg">
          <Text className="text-2xl font-bold text-ui-tag-orange-text">{stats.pending}</Text>
          <Text size="small" className="text-ui-fg-subtle">Pending</Text>
        </div>
        <div className="text-center p-4 bg-ui-bg-subtle rounded-lg">
          <Text className="text-2xl font-bold text-ui-fg-error">{stats.failed}</Text>
          <Text size="small" className="text-ui-fg-subtle">Failed</Text>
        </div>
      </div>
      
      {/* Progress Bar */}
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-2">
          <Text size="small" className="text-ui-fg-subtle">Progress</Text>
          <Text size="small" className="text-ui-fg-subtle">
            {Math.round((stats.published / stats.total) * 100)}%
          </Text>
        </div>
        <div className="h-2 bg-ui-bg-subtle rounded-full overflow-hidden">
          <div 
            className="h-full bg-ui-fg-interactive rounded-full transition-all"
            style={{ width: `${(stats.published / stats.total) * 100}%` }}
          />
        </div>
      </div>
    </Container>
  )
}

type CampaignActionsSectionProps = {
  campaign: Campaign
  onStart: () => void
  onPause: () => void
  onCancel: () => void
  onPreview: () => void
  isStarting: boolean
  isPausing: boolean
  isPreviewing: boolean
}

const CampaignActionsSection = ({ 
  campaign, 
  onStart, 
  onPause, 
  onCancel, 
  onPreview,
  isStarting,
  isPausing,
  isPreviewing,
}: CampaignActionsSectionProps) => {
  const prompt = usePrompt()
  const retryAllMutation = useRetryAllFailedItems()
  
  const canStart = ["draft", "preview", "paused"].includes(campaign.status)
  const canPause = campaign.status === "active"
  const canCancel = ["active", "paused", "draft", "preview"].includes(campaign.status)
  const canPreview = ["draft", "preview"].includes(campaign.status)
  
  // Check if there are failed items to retry
  const failedCount = campaign.stats?.failed || 0
  const canRetryAll = failedCount > 0
  
  const handleRetryAll = async () => {
    const confirmed = await prompt({
      title: "Retry All Failed Items",
      description: `Are you sure you want to retry all ${failedCount} failed item(s)?`,
      confirmText: "Retry All",
      cancelText: "Cancel",
    })
    if (confirmed) {
      try {
        const result = await retryAllMutation.mutateAsync(campaign.id)
        toast.success(result.message)
      } catch (e: any) {
        toast.error(e.message || "Failed to retry items")
      }
    }
  }
  
  const handleCancel = async () => {
    const confirmed = await prompt({
      title: "Cancel Campaign",
      description: "Are you sure you want to cancel this campaign? All pending items will be skipped.",
      confirmText: "Cancel Campaign",
      cancelText: "Keep Running",
    })
    if (confirmed) {
      onCancel()
    }
  }
  
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Actions</Heading>
      </div>
      
      <div className="p-6 space-y-3">
        {canPreview && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={onPreview}
            isLoading={isPreviewing}
          >
            <EyeMini className="mr-2" />
            Generate Preview
          </Button>
        )}
        
        {canStart && (
          <Button
            variant="primary"
            className="w-full"
            onClick={onStart}
            isLoading={isStarting}
          >
            <PlaySolid className="mr-2" />
            {campaign.status === "paused" ? "Resume Campaign" : "Start Campaign"}
          </Button>
        )}
        
        {canPause && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={onPause}
            isLoading={isPausing}
          >
            <PauseSolid className="mr-2" />
            Pause Campaign
          </Button>
        )}
        
        {canCancel && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={handleCancel}
          >
            <XCircleSolid className="mr-2" />
            Cancel Campaign
          </Button>
        )}
        
        {canRetryAll && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={handleRetryAll}
            isLoading={retryAllMutation.isPending}
          >
            <ArrowPath className="mr-2" />
            Retry All Failed ({failedCount})
          </Button>
        )}
      </div>
      
      {/* Status indicator */}
      {campaign.status === "active" && campaign.next_publish_at && (
        <div className="px-6 py-4 bg-ui-bg-highlight">
          <div className="flex items-center gap-2">
            <ArrowPath className="w-4 h-4 text-ui-fg-interactive animate-spin" />
            <Text size="small">
              Next publish: {new Date(campaign.next_publish_at).toLocaleString()}
            </Text>
          </div>
        </div>
      )}
      
      {campaign.status === "completed" && (
        <div className="px-6 py-4 bg-ui-tag-green-bg">
          <div className="flex items-center gap-2">
            <CheckCircleSolid className="w-4 h-4 text-ui-tag-green-icon" />
            <Text size="small" className="text-ui-tag-green-text">
              Campaign completed
            </Text>
          </div>
        </div>
      )}
    </Container>
  )
}

// ============ Main Page Component ============

const CampaignDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const initialData = useLoaderData() as Campaign | undefined
  
  const { data: campaign, isLoading, error } = useCampaign(id!, {
    initialData,
  })
  const startMutation = useStartCampaign()
  const pauseMutation = usePauseCampaign()
  const cancelMutation = useCancelCampaign()
  const previewMutation = usePreviewCampaign()
  const deleteMutation = useDeleteCampaign()
  
  if (isLoading && !initialData) {
    return <TwoColumnPageSkeleton />
  }
  
  if (error || !campaign) {
    return (
      <Container className="p-6">
        <Text className="text-ui-fg-error">
          {error?.message || "Campaign not found"}
        </Text>
      </Container>
    )
  }
  
  const handleStart = async () => {
    try {
      await startMutation.mutateAsync(id!)
      toast.success("Campaign started")
    } catch (e: any) {
      toast.error(e.message || "Failed to start campaign")
    }
  }
  
  const handlePause = async () => {
    try {
      await pauseMutation.mutateAsync(id!)
      toast.success("Campaign paused")
    } catch (e: any) {
      toast.error(e.message || "Failed to pause campaign")
    }
  }
  
  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync(id!)
      toast.success("Campaign cancelled")
    } catch (e: any) {
      toast.error(e.message || "Failed to cancel campaign")
    }
  }
  
  const handlePreview = async () => {
    try {
      const preview = await previewMutation.mutateAsync(id!)
      toast.success(`Preview generated for ${preview.items.length} items`)
    } catch (e: any) {
      toast.error(e.message || "Failed to generate preview")
    }
  }
  
  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(id!)
      toast.success("Campaign deleted")
      navigate("/publishing-campaigns")
    } catch (e: any) {
      toast.error(e.message || "Failed to delete campaign")
    }
  }
  
  return (
    <TwoColumnPage
      showJSON
      hasOutlet
      data={campaign}
    >
      <TwoColumnPage.Main>
        <CampaignGeneralSection 
          campaign={campaign}
          onStart={handleStart}
          onPause={handlePause}
          onCancel={handleCancel}
          onPreview={handlePreview}
          onDelete={handleDelete}
          isStarting={startMutation.isPending}
          isPausing={pauseMutation.isPending}
          isPreviewing={previewMutation.isPending}
        />
        <CampaignItemsSection campaign={campaign} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <CampaignStatsSection campaign={campaign} />
        <CampaignActionsSection 
          campaign={campaign}
          onStart={handleStart}
          onPause={handlePause}
          onCancel={handleCancel}
          onPreview={handlePreview}
          isStarting={startMutation.isPending}
          isPausing={pauseMutation.isPending}
          isPreviewing={previewMutation.isPending}
        />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

export default CampaignDetailPage

export async function loader({ params }: LoaderFunctionArgs) {
  return await campaignLoader({ params })
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    return match.params.id || "Campaign"
  },
}
