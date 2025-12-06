/**
 * Publishing Automation Types
 * 
 * Types for automated social media publishing campaigns using long-running workflows.
 * No database tables needed - state is managed by MedusaJS workflow engine.
 */

/**
 * Content rule configuration for generating social media posts from products
 */
export interface ContentRule {
  /** Unique identifier for the rule */
  id: string
  
  /** Human-readable name */
  name: string
  
  /** 
   * Caption template with placeholders:
   * - {{title}} - Product title
   * - {{description}} - Product description (will be truncated)
   * - {{price}} - Formatted price
   * - {{design_name}} - Linked design name
   * - {{design_description}} - Linked design description
   * - {{hashtags}} - Generated hashtags
   * - {{url}} - Product URL (if available)
   */
  caption_template: string
  
  /** Maximum characters for description (platform-specific defaults apply) */
  description_max_length: number
  
  /** Include price in the post */
  include_price: boolean
  
  /** Include linked design details */
  include_design: boolean
  
  /** Hashtag strategy */
  hashtag_strategy: "from_product" | "from_design" | "custom" | "none"
  
  /** Custom hashtags (used when strategy is "custom") */
  custom_hashtags: string[]
  
  /** Image selection strategy */
  image_selection: "thumbnail" | "first" | "all" | "featured"
  
  /** Maximum number of images (platform limits apply) */
  max_images: number
}

/**
 * Default content rules for different platforms
 */
export const DEFAULT_CONTENT_RULES: Record<string, ContentRule> = {
  instagram: {
    id: "default_instagram",
    name: "Instagram Product Showcase",
    caption_template: `✨ {{title}}

{{description}}

{{#if design_name}}🎨 Design: {{design_name}}{{/if}}

{{hashtags}}`,
    description_max_length: 200,
    include_price: false,
    include_design: true,
    hashtag_strategy: "from_product",
    custom_hashtags: [],
    image_selection: "all",
    max_images: 10,
  },
  facebook: {
    id: "default_facebook",
    name: "Facebook Product Post",
    caption_template: `{{title}}

{{description}}

{{#if price}}💰 {{price}}{{/if}}

{{#if url}}🔗 {{url}}{{/if}}`,
    description_max_length: 500,
    include_price: true,
    include_design: true,
    hashtag_strategy: "none",
    custom_hashtags: [],
    image_selection: "featured",
    max_images: 4,
  },
  x: {
    id: "default_x",
    name: "X/Twitter Product Tweet",
    caption_template: `{{title}}

{{description}}

{{hashtags}}`,
    description_max_length: 200, // Leave room for hashtags within 280 limit
    include_price: false,
    include_design: false,
    hashtag_strategy: "from_product",
    custom_hashtags: [],
    image_selection: "first",
    max_images: 4,
  },
  fbinsta: {
    id: "default_fbinsta",
    name: "Facebook & Instagram Combined",
    caption_template: `✨ {{title}}

{{description}}

{{#if design_name}}🎨 Design: {{design_name}}{{/if}}

{{hashtags}}`,
    description_max_length: 200,
    include_price: false,
    include_design: true,
    hashtag_strategy: "from_product",
    custom_hashtags: [],
    image_selection: "all",
    max_images: 10,
  },
}

/**
 * Campaign status
 */
export type CampaignStatus = 
  | "draft"      // Not started, can be edited
  | "preview"    // Generated content ready for review
  | "active"     // Publishing in progress
  | "paused"     // Temporarily stopped
  | "completed"  // All items published
  | "cancelled"  // Manually cancelled

/**
 * Individual item in the publishing queue
 */
export interface CampaignItem {
  /** Product ID */
  product_id: string
  
  /** Position in queue (0-indexed) */
  position: number
  
  /** Scheduled publish time */
  scheduled_at: Date
  
  /** Item status */
  status: "pending" | "publishing" | "published" | "failed" | "skipped"
  
  /** Generated content (populated during preview) */
  generated_content?: GeneratedContent
  
  /** Created social post ID (after publishing) */
  social_post_id?: string
  
  /** Error message if failed */
  error_message?: string
  
  /** Actual publish time */
  published_at?: Date
}

/**
 * Generated content from applying a content rule to a product
 */
export interface GeneratedContent {
  /** Post caption/text */
  caption: string
  
  /** Media attachments */
  media_attachments: Array<{
    type: "image" | "video"
    url: string
  }>
  
  /** Extracted/generated hashtags */
  hashtags: string[]
  
  /** Product title (for reference) */
  product_title: string
  
  /** Product ID */
  product_id: string
  
  /** Linked design info (if any) */
  design?: {
    id: string
    name: string
    description?: string
  }
}

/**
 * Input for starting a publishing campaign workflow
 */
export interface StartCampaignInput {
  /** Campaign name */
  name: string
  
  /** Product IDs to publish */
  product_ids: string[]
  
  /** Target social platform ID */
  platform_id: string
  
  /** Content rule to apply */
  content_rule: ContentRule
  
  /** Hours between each publish (default: 24) */
  interval_hours: number
  
  /** Start date/time (default: now) */
  start_at?: Date
  
  /** Optional: specific time of day to publish (e.g., "10:00") */
  publish_time?: string
}

/**
 * Campaign state stored in workflow
 */
export interface CampaignState {
  /** Campaign ID (workflow transaction ID) */
  id: string
  
  /** Campaign name */
  name: string
  
  /** Platform ID */
  platform_id: string
  
  /** Platform name (for display) */
  platform_name: string
  
  /** Content rule used */
  content_rule: ContentRule
  
  /** Interval between publishes */
  interval_hours: number
  
  /** Campaign status */
  status: CampaignStatus
  
  /** All items in the campaign */
  items: CampaignItem[]
  
  /** Current item index being processed */
  current_index: number
  
  /** Campaign start time */
  started_at?: Date
  
  /** Campaign completion time */
  completed_at?: Date
  
  /** Pause time (if paused) */
  paused_at?: Date
  
  /** Error message (if failed) */
  error_message?: string
  
  /** Statistics */
  stats: {
    total: number
    published: number
    failed: number
    pending: number
  }
}

/**
 * Preview response for a campaign
 */
export interface CampaignPreview {
  /** Campaign name */
  name: string
  
  /** Platform info */
  platform: {
    id: string
    name: string
  }
  
  /** Content rule used */
  content_rule: ContentRule
  
  /** Preview of all items with generated content */
  items: Array<{
    position: number
    product_id: string
    product_title: string
    scheduled_at: Date
    generated_content: GeneratedContent
  }>
  
  /** Validation warnings (e.g., missing images) */
  warnings: Array<{
    product_id: string
    message: string
  }>
}

/**
 * Campaign summary for listing
 */
export interface CampaignSummary {
  id: string
  name: string
  platform_name: string
  status: CampaignStatus
  total_items: number
  published_count: number
  failed_count: number
  next_publish_at?: Date
  started_at?: Date
  completed_at?: Date
}
