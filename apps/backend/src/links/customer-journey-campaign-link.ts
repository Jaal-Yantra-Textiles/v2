import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import SocialsModule from "../modules/socials"

/**
 * Read-only link from CustomerJourney to AdCampaign
 *
 * Enables graph queries like:
 * - Get journey event with campaign details
 * - Get campaign with all its journey events
 */
export default defineLink(
  {
    linkable: SocialsModule.linkable.adCampaign,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.customerJourney.id,
    primaryKey: "ad_campaign_id",
  },
  {
    readOnly: true,
  }
)
