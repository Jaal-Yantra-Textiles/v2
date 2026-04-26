import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import SocialsModule from "../modules/socials"

/**
 * Read-only link from BudgetForecast to AdCampaign
 *
 * Enables graph queries like:
 * - Get forecast with campaign details
 * - Get campaign with all its forecasts
 */
export default defineLink(
  {
    linkable: SocialsModule.linkable.adCampaign,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.budgetForecast.id,
    primaryKey: "ad_campaign_id",
  },
  {
    readOnly: true,
  }
)
