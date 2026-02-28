import { z } from "@medusajs/framework/zod"

// Content rule schema for campaign mode - all fields optional for form flexibility
export const ContentRuleSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  caption_template: z.string().optional(),
  description_max_length: z.number().optional(),
  include_price: z.boolean().optional(),
  include_design: z.boolean().optional(),
  hashtag_strategy: z.enum(["from_product", "from_design", "custom", "none"]).optional(),
  custom_hashtags: z.array(z.string()).optional(),
  image_selection: z.enum(["thumbnail", "first", "all", "featured"]).optional(),
  max_images: z.number().optional(),
}).optional()

export type ContentRule = z.infer<typeof ContentRuleSchema>

export const BaseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  platform_id: z.string().min(1, "Platform is required"),
  platform_name: z.string().optional(),
  // Optional fields for platform-specific payload
  post_type: z.enum(["photo", "feed", "reel"]).optional(),
  message: z.string().optional(),
  link: z.string().url().optional().or(z.literal("")),
  media_urls: z.array(z.string().url()).optional(),
  // Chosen page to target (stored into metadata.page_id on submit)
  page_id: z.string().optional(),
  // Instagram target account (stored into metadata.ig_user_id)
  ig_user_id: z.string().optional(),
  // Publish target for FBINSTA: "facebook", "instagram", or "both"
  publish_target: z.enum(["facebook", "instagram", "both"]).optional(),
  // Automation
  auto_publish: z.boolean().optional(),
  
  // Campaign mode fields
  is_campaign: z.boolean().optional(),
  product_ids: z.array(z.string()).optional(),
  interval_hours: z.number().min(1).max(168).optional(),
  start_at: z.string().optional(),
  content_rule: ContentRuleSchema.optional(),
  custom_caption_template: z.string().optional(),
})

export const CreateSocialPostSchema = BaseSchema.superRefine((data, ctx) => {
  const platform = (data.platform_name || "").toLowerCase()
  
  // Campaign mode validation
  if (data.is_campaign) {
    if (!data.product_ids || data.product_ids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["product_ids"],
        message: "Select at least one product for the campaign",
      })
    }
    // interval_hours has a default of 24, only validate if explicitly set to invalid value
    if (data.interval_hours !== undefined && data.interval_hours < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interval_hours"],
        message: "Interval must be at least 1 hour",
      })
    }
    // Campaign mode doesn't need single post validations
    return
  }
  
  // FBINSTA validation
  if (platform === "fbinsta" || platform === "facebook & instagram") {
    if (!data.publish_target) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publish_target"],
        message: "Please select where to publish",
      })
      return
    }
    if (!data.post_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["post_type"],
        message: "Post type is required",
      })
      return
    }
    
    // Validate Facebook Page if publishing to Facebook or Both
    if (data.publish_target === "facebook" || data.publish_target === "both") {
      if (!data.page_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["page_id"],
          message: "Facebook page is required",
        })
      }
    }
    
    // Validate Instagram Account if publishing to Instagram or Both
    if (data.publish_target === "instagram" || data.publish_target === "both") {
      if (!data.ig_user_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ig_user_id"],
          message: "Instagram account is required",
        })
      }
    }
    
    const urls = data.media_urls ?? []
    if (data.post_type === "photo") {
      if (urls.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["media_urls"],
          message: "Select at least one image",
        })
      } else if (urls.length > 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["media_urls"],
          message: "Maximum 10 images allowed for carousel",
        })
      }
    }
    return
  }
  
  if (platform === "facebook") {
    if (!data.post_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["post_type"],
        message: "Post type is required for Facebook",
      })
      return
    }
    if (data.post_type === "photo") {
      const urls = data.media_urls ?? []
      if (urls.length < 1 || urls.length > 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["media_urls"],
          message: "Select between 1 and 10 images",
        })
      }
    }
    if (data.post_type === "feed") {
      if (!data.message || !data.message.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["message"],
          message: "Message is required for feed posts",
        })
      }
    }
  }
  
  if (platform === "instagram") {
    if (!data.post_type) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["post_type"], message: "Post type is required for Instagram" })
      return
    }
    if (!data.ig_user_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ig_user_id"], message: "Select an Instagram account" })
    }
    const urls = data.media_urls ?? []
    if (data.post_type === "photo") {
      if (urls.length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["media_urls"], message: "Select at least one image" })
      } else if (urls.length > 10) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["media_urls"], message: "Maximum 10 images for carousel" })
      }
    }
    if (data.post_type === "reel") {
      if (urls.length !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["media_urls"], message: "Select exactly one video" })
      }
    }
  }
})

export type CreateSocialPostForm = z.infer<typeof CreateSocialPostSchema>
