/**
 * Recalculate Customer Scores Job
 *
 * Weekly job to recalculate engagement, churn risk, and CLV scores.
 * Runs every Sunday at 3 AM.
 */

import { MedusaContainer } from "@medusajs/framework";
import { PERSON_MODULE } from "../../modules/person";
import { AD_PLANNING_MODULE } from "../../modules/ad-planning";
import { calculateEngagementWorkflow } from "../../workflows/ad-planning/scoring/calculate-engagement";
import { calculateChurnRiskWorkflow } from "../../workflows/ad-planning/predictive/calculate-churn-risk";
import { calculateCLVWorkflow } from "../../workflows/ad-planning/predictive/calculate-clv";

export default async function recalculateScoresJob(container: MedusaContainer) {
  console.log("[AdPlanning] Starting weekly score recalculation job...");

  const personService = container.resolve(PERSON_MODULE);
  const adPlanningService = container.resolve(AD_PLANNING_MODULE);

  try {
    // Get all persons who have had conversions or journey events
    const conversions = await adPlanningService.listConversions({});
    const journeys = await adPlanningService.listCustomerJourneys({});

    // Get unique person IDs
    const personIds = new Set<string>();
    for (const conv of conversions) {
      if (conv.person_id) personIds.add(conv.person_id);
    }
    for (const journey of journeys) {
      if (journey.person_id) personIds.add(journey.person_id);
    }

    console.log(`[AdPlanning] Recalculating scores for ${personIds.size} customers...`);

    let processed = 0;
    let errors = 0;

    for (const personId of personIds) {
      try {
        // Calculate engagement score
        await calculateEngagementWorkflow(container).run({
          input: { person_id: personId },
        });

        // Calculate churn risk
        await calculateChurnRiskWorkflow(container).run({
          input: { person_id: personId },
        });

        // Calculate CLV
        await calculateCLVWorkflow(container).run({
          input: { person_id: personId },
        });

        processed++;

        // Log progress every 100 customers
        if (processed % 100 === 0) {
          console.log(`[AdPlanning] Processed ${processed}/${personIds.size} customers...`);
        }
      } catch (error) {
        errors++;
        console.error(`[AdPlanning] Failed to calculate scores for person ${personId}:`, error);
      }
    }

    console.log(`[AdPlanning] Score recalculation complete:`, {
      total_customers: personIds.size,
      processed,
      errors,
    });
  } catch (error) {
    console.error("[AdPlanning] Score recalculation job failed:", error);
  }
}

export const config = {
  name: "recalculate-customer-scores",
  schedule: "0 3 * * 0", // 3 AM every Sunday
};
