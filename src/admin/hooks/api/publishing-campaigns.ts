import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

// Types
export interface ContentRule {
  id: string
  name: string
  caption_template: string
  description_max_length: number
  include_price: boolean
  include_design: boolean
  hashtag_strategy: "from_product" | "from_design" | "custom" | "none"
  custom_hashtags: string[]
  image_selection: "thumbnail" | "first" | "all" | "featured"
  max_images: number
}

export interface CampaignItem {
  product_id: string
  position: number
  scheduled_at: string
  status: "pending" | "publishing" | "published" | "failed" | "skipped"
  social_post_id?: string
  error_message?: string
  published_at?: string
}

export interface Campaign {
  id: string
  name: string
  status: "draft" | "preview" | "active" | "paused" | "completed" | "cancelled"
  platform_id: string
  content_rule: ContentRule
  interval_hours: number
  items: CampaignItem[]
  current_index: number
  started_at?: string
  completed_at?: string
  paused_at?: string
  error_message?: string
  created_at: string
  updated_at: string
  platform?: {
    id: string
    name: string
  }
  stats?: {
    total: number
    published: number
    failed: number
    pending: number
    skipped: number
  }
  next_publish_at?: string
}

export interface CampaignPreview {
  name: string
  platform: { id: string; name: string }
  content_rule: ContentRule
  items: Array<{
    position: number
    product_id: string
    product_title: string
    scheduled_at: string
    generated_content: {
      caption: string
      media_attachments: Array<{ type: "image" | "video"; url: string }>
      hashtags: string[]
      product_title: string
      product_id: string
    }
  }>
  warnings: Array<{ product_id: string; message: string }>
}

// Query keys
export const campaignKeys = {
  all: ["publishing-campaigns"] as const,
  lists: () => [...campaignKeys.all, "list"] as const,
  list: (filters: Record<string, any>) => [...campaignKeys.lists(), filters] as const,
  details: () => [...campaignKeys.all, "detail"] as const,
  detail: (id: string) => [...campaignKeys.details(), id] as const,
  contentRules: () => [...campaignKeys.all, "content-rules"] as const,
}

/**
 * Hook to list publishing campaigns
 */
export const useCampaigns = (params?: { status?: string; limit?: number; offset?: number }) => {
  return useQuery({
    queryKey: campaignKeys.list(params || {}),
    queryFn: async () => {
      const query: Record<string, string> = {}
      if (params?.status) query.status = params.status
      if (params?.limit) query.limit = params.limit.toString()
      if (params?.offset) query.offset = params.offset.toString()
      
      const response = await sdk.client.fetch<{ 
        campaigns: Campaign[]
        count: number 
      }>(`/admin/publishing-campaigns`, { query })
      
      return response
    },
  })
}

/**
 * Hook to get a single campaign
 */
export const useCampaign = (
  id: string, 
  options?: { initialData?: Campaign }
) => {
  return useQuery({
    queryKey: campaignKeys.detail(id),
    queryFn: async () => {
      const response = await sdk.client.fetch<{ campaign: Campaign }>(
        `/admin/publishing-campaigns/${id}`
      )
      return response.campaign
    },
    enabled: !!id,
    initialData: options?.initialData,
  })
}

/**
 * Hook to get content rules
 */
export const useContentRules = (platform?: string) => {
  return useQuery({
    queryKey: [...campaignKeys.contentRules(), platform],
    queryFn: async () => {
      const query: Record<string, string> = {}
      if (platform) query.platform = platform
      
      const response = await sdk.client.fetch<{ 
        rules?: Record<string, ContentRule>
        rule?: ContentRule
        available_platforms: string[]
      }>(`/admin/publishing-campaigns/content-rules`, { query })
      
      return response
    },
  })
}

/**
 * Hook to create a campaign
 */
export const useCreateCampaign = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: {
      name: string
      product_ids: string[]
      platform_id: string
      content_rule?: ContentRule
      interval_hours?: number
      start_at?: string
    }) => {
      const response = await sdk.client.fetch<{ campaign: Campaign }>(
        `/admin/publishing-campaigns`,
        { method: "POST", body: data }
      )
      return response.campaign
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.lists() })
    },
  })
}

/**
 * Hook to update a campaign
 */
export const useUpdateCampaign = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, ...data }: { 
      id: string
      name?: string
      content_rule?: ContentRule
      interval_hours?: number
    }) => {
      const response = await sdk.client.fetch<{ campaign: Campaign }>(
        `/admin/publishing-campaigns/${id}`,
        { method: "PUT", body: data }
      )
      return response.campaign
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.detail(variables.id) })
      queryClient.invalidateQueries({ queryKey: campaignKeys.lists() })
    },
  })
}

/**
 * Hook to delete a campaign
 */
export const useDeleteCampaign = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      await sdk.client.fetch(`/admin/publishing-campaigns/${id}`, { method: "DELETE" })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.lists() })
    },
  })
}

/**
 * Hook to preview a campaign
 */
export const usePreviewCampaign = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await sdk.client.fetch<{ preview: CampaignPreview }>(
        `/admin/publishing-campaigns/${id}/preview`,
        { method: "POST" }
      )
      return response.preview
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.detail(id) })
    },
  })
}

/**
 * Hook to start a campaign
 */
export const useStartCampaign = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await sdk.client.fetch<{ campaign: Campaign; message: string }>(
        `/admin/publishing-campaigns/${id}/start`,
        { method: "POST" }
      )
      return response
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: campaignKeys.lists() })
    },
  })
}

/**
 * Hook to pause a campaign
 */
export const usePauseCampaign = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await sdk.client.fetch<{ campaign: Campaign; message: string }>(
        `/admin/publishing-campaigns/${id}/pause`,
        { method: "POST" }
      )
      return response
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: campaignKeys.lists() })
    },
  })
}

/**
 * Hook to cancel a campaign
 */
export const useCancelCampaign = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await sdk.client.fetch<{ campaign: Campaign; message: string }>(
        `/admin/publishing-campaigns/${id}/cancel`,
        { method: "POST" }
      )
      return response
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: campaignKeys.lists() })
    },
  })
}

/**
 * Hook to skip an item in a campaign
 */
export const useSkipCampaignItem = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, item_index }: { id: string; item_index: number }) => {
      const response = await sdk.client.fetch<{ campaign: Campaign; message: string }>(
        `/admin/publishing-campaigns/${id}/skip-item`,
        { method: "POST", body: { item_index } }
      )
      return response
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.detail(id) })
    },
  })
}

/**
 * Hook to reschedule a campaign
 */
export const useRescheduleCampaign = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, start_at, interval_hours }: { 
      id: string
      start_at?: string
      interval_hours?: number 
    }) => {
      const response = await sdk.client.fetch<{ campaign: Campaign; message: string }>(
        `/admin/publishing-campaigns/${id}/reschedule`,
        { method: "POST", body: { start_at, interval_hours } }
      )
      return response
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.detail(id) })
    },
  })
}

/**
 * Hook to retry a failed campaign item
 */
export const useRetryCampaignItem = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, item_index }: { id: string; item_index: number }) => {
      const response = await sdk.client.fetch<{ 
        success: boolean
        campaign: Campaign
        item: CampaignItem
        error?: string
      }>(
        `/admin/publishing-campaigns/${id}/retry-item`,
        { method: "POST", body: { item_index } }
      )
      return response
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: campaignKeys.lists() })
    },
  })
}

/**
 * Hook to retry all failed items in a campaign
 */
export const useRetryAllFailedItems = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await sdk.client.fetch<{ 
        success: boolean
        message: string
        retried: number
        succeeded: number
        failed: number
        campaign: Campaign
      }>(
        `/admin/publishing-campaigns/${id}/retry-all`,
        { method: "POST" }
      )
      return response
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: campaignKeys.lists() })
    },
  })
}
