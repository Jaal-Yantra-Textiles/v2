import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import PersonModule from "../modules/person"

/**
 * Read-only link from CustomerScore to Person
 *
 * Enables graph queries like:
 * - Get customer score with person details
 * - Get person with all their scores (NPS, engagement, CLV, churn risk)
 */
export default defineLink(
  {
    linkable: PersonModule.linkable.person,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.customerScore.id,
    primaryKey: "person_id",
  },
  {
    readOnly: true,
  }
)
