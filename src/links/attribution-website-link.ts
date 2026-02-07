import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import WebsiteModule from "../modules/website"

/**
 * Read-only link from CampaignAttribution to Website
 *
 * Enables graph queries like:
 * - Get attribution with website details
 * - Get website with all its attributions
 */
export default defineLink(
  {
    linkable: WebsiteModule.linkable.website,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.campaignAttribution.id,
    primaryKey: "website_id",
  },
  {
    readOnly: true,
  }
)
