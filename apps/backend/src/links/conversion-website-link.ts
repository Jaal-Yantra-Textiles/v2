import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import WebsiteModule from "../modules/website"

/**
 * Read-only link from Conversion to Website
 *
 * Enables graph queries like:
 * - Get conversion with website details
 * - Get website with all its conversions
 */
export default defineLink(
  {
    linkable: WebsiteModule.linkable.website,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.conversion.id,
    primaryKey: "website_id",
  },
  {
    readOnly: true,
  }
)
