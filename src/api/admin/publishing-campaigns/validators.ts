import { z } from "@medusajs/framework/zod"

// Content rule schema
export const ContentRuleSchema = z.object({
  hashtag_strategy: z.enum(["from_product", "from_design", "custom", "none"]).optional(),
  image_selection: z.enum(["thumbnail", "first", "all", "featured"]).optional(),
  custom_hashtags: z.array(z.string()).optional(),
  caption_template: z.string().optional(),
})

// Create campaign schema
export const CreatePublishingCampaignSchema = z.object({
  name: z.string().min(1, "Campaign name is required"),
  product_ids: z.array(z.string()).min(1, "At least one product is required"),
  platform_id: z.string().min(1, "Platform ID is required"),
  content_rule: ContentRuleSchema.optional(),
  interval_hours: z.number().int().min(1).default(24),
  start_at: z.string().datetime().optional(),
})

export type CreatePublishingCampaign = z.infer<typeof CreatePublishingCampaignSchema>

// Update campaign schema
export const UpdatePublishingCampaignSchema = z.object({
  name: z.string().min(1).optional(),
  interval_hours: z.number().int().min(1).optional(),
  content_rule: ContentRuleSchema.optional(),
})

export type UpdatePublishingCampaign = z.infer<typeof UpdatePublishingCampaignSchema>

// List campaigns query schema
export const ListPublishingCampaignsQuerySchema = z.object({
  status: z.enum(["draft", "preview", "active", "paused", "completed", "cancelled"]).optional(),
  limit: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(1).max(100).default(50)
  ),
  offset: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(0).default(0)
  ),
})

export type ListPublishingCampaignsQuery = z.infer<typeof ListPublishingCampaignsQuerySchema>

// Retry item schema
export const RetryItemSchema = z.object({
  item_index: z.number().int().min(0),
})

export type RetryItem = z.infer<typeof RetryItemSchema>
