import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import SocialsModule from "../modules/socials"

/**
 * Read-only link from Conversion to AdCampaign
 *
 * Enables graph queries like:
 * - Get conversion with campaign details
 * - Get campaign with all its tracked conversions
 *
 * Note: Uses field name "tracked_conversions" to avoid conflict with
 * AdCampaign's existing "conversions" field (which stores count as bigNumber)
 */
export default defineLink(
  {
    linkable: SocialsModule.linkable.adCampaign,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.conversion.id,
    primaryKey: "ad_campaign_id",
    field: "tracked_conversions",
  },
  {
    readOnly: true,
  }
)
