import { model } from "@medusajs/framework/utils"
import SocialPlatform from "./SocialPlatform"

/**
 * Publishing Campaign Model
 * 
 * Stores the state of automated publishing campaigns.
 * Each campaign publishes a set of products to a social platform on a schedule.
 */
const PublishingCampaign = model.define("PublishingCampaign", {
  id: model.id().primaryKey(),
  
  /** Campaign name */
  name: model.text().searchable(),
  
  /** Campaign status */
  status: model.enum([
    "draft",      // Not started, can be edited
    "preview",    // Generated content ready for review
    "active",     // Publishing in progress
    "paused",     // Temporarily stopped
    "completed",  // All items published
    "cancelled",  // Manually cancelled
  ]).default("draft"),
  
  /** Content rule configuration (JSON) */
  content_rule: model.json(),
  
  /** Hours between each publish */
  interval_hours: model.number().default(24),
  
  /** Campaign items with their status (JSON array) */
  items: model.json(),
  
  /** Current item index being processed */
  current_index: model.number().default(0),
  
  /** Campaign start time */
  started_at: model.dateTime().nullable(),
  
  /** Campaign completion time */
  completed_at: model.dateTime().nullable(),
  
  /** Pause time */
  paused_at: model.dateTime().nullable(),
  
  /** Error message if failed */
  error_message: model.text().nullable(),
  
  /** Additional metadata */
  metadata: model.json().nullable(),
  
  /** Target platform */
  platform: model.belongsTo(() => SocialPlatform, { foreignKey: "platform_id" }),
})

export default PublishingCampaign
