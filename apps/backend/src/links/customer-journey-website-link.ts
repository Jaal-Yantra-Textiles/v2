import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import WebsiteModule from "../modules/website"

/**
 * Read-only link from CustomerJourney to Website
 *
 * Enables graph queries like:
 * - Get journey event with website details
 * - Get website with all its journey events
 */
export default defineLink(
  {
    linkable: WebsiteModule.linkable.website,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.customerJourney.id,
    primaryKey: "website_id",
  },
  {
    readOnly: true,
  }
)
