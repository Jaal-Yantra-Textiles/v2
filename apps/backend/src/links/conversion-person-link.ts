import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import PersonModule from "../modules/person"

/**
 * Read-only link from Conversion to Person
 *
 * Enables graph queries like:
 * - Get conversion with person details
 * - Get person with all their conversions
 */
export default defineLink(
  {
    linkable: PersonModule.linkable.person,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.conversion.id,
    primaryKey: "person_id",
  },
  {
    readOnly: true,
  }
)
