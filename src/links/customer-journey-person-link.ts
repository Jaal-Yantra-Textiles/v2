import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import PersonModule from "../modules/person"

/**
 * Read-only link from CustomerJourney to Person
 *
 * Enables graph queries like:
 * - Get journey event with person details
 * - Get person with all their journey events
 */
export default defineLink(
  {
    linkable: PersonModule.linkable.person,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.customerJourney.id,
    primaryKey: "person_id",
  },
  {
    readOnly: true,
  }
)
