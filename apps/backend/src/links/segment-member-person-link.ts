import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import PersonModule from "../modules/person"

/**
 * Read-only link from SegmentMember to Person
 *
 * Enables graph queries like:
 * - Get segment member with person details
 * - Get person with all segments they belong to
 */
export default defineLink(
  {
    linkable: PersonModule.linkable.person,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.segmentMember.id,
    primaryKey: "person_id",
  },
  {
    readOnly: true,
  }
)
