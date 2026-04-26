import { defineLink } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"
import PersonModule from "../modules/person"

/**
 * Read-only link from SentimentAnalysis to Person
 *
 * Enables graph queries like:
 * - Get sentiment analysis with person details
 * - Get person with all their sentiment analyses
 */
export default defineLink(
  {
    linkable: PersonModule.linkable.person,
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.sentimentAnalysis.id,
    primaryKey: "person_id",
  },
  {
    readOnly: true,
  }
)
