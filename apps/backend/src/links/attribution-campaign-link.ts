import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import SocialsModule from "../modules/socials"

/**
 * Read-only link from CampaignAttribution to AdCampaign
 *
 * Enables graph queries like:
 * - Get attribution with campaign details
 * - Get campaign with all its attributions
 */
export default defineLink(
  {
    linkable: SocialsModule.linkable.adCampaign,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.campaignAttribution.id,
    primaryKey: "ad_campaign_id",
  },
  {
    readOnly: true,
  }
)
