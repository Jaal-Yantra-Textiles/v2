import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import WebsiteModule from "../modules/website"

/**
 * Read-only link from ConversionGoal to Website
 *
 * Enables graph queries like:
 * - Get conversion goal with website details
 * - Get website with all its conversion goals
 */
export default defineLink(
  {
    linkable: WebsiteModule.linkable.website,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.conversionGoal.id,
    primaryKey: "website_id",
  },
  {
    readOnly: true,
  }
)
