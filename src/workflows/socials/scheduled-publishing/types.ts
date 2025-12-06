/**
 * Types for Scheduled Publishing Workflow
 */

import { ContentRule, CampaignItem, CampaignStatus } from "../../../modules/socials/types/publishing-automation"

export interface ScheduledPublishingInput {
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
  start_at?: string // ISO date string
}

export interface CampaignWorkflowState {
  /** Campaign name */
  name: string
  
  /** Platform ID */
  platform_id: string
  
  /** Platform name */
  platform_name: string
  
  /** Content rule */
  content_rule: ContentRule
  
  /** Interval hours */
  interval_hours: number
  
  /** Campaign status */
  status: CampaignStatus
  
  /** All items */
  items: CampaignItem[]
  
  /** Current processing index */
  current_index: number
  
  /** Started at */
  started_at: string | null
  
  /** Completed at */
  completed_at: string | null
  
  /** Paused at */
  paused_at: string | null
}

export const SCHEDULED_PUBLISHING_WORKFLOW_ID = "scheduled-product-publishing"
