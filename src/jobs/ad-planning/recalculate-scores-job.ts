/**
 * Recalculate Customer Scores Job
 *
 * Weekly job to recalculate engagement, churn risk, and CLV scores for
 * customers who had activity in the last 30 days.
 *
 * Runs every Sunday at 3 AM.
 */

import { MedusaContainer } from "@medusajs/framework";
import { AD_PLANNING_MODULE } from "../../modules/ad-planning";
import { calculateEngagementWorkflow } from "../../workflows/ad-planning/scoring/calculate-engagement";
import { calculateChurnRiskWorkflow } from "../../workflows/ad-planning/predictive/calculate-churn-risk";
import { calculateCLVWorkflow } from "../../workflows/ad-planning/predictive/calculate-clv";

const PAGE_SIZE = 500;
const ACTIVITY_WINDOW_DAYS = 30;
const CONCURRENCY = 5;

// Process an array with bounded concurrency (simple manual pool)
async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = items.slice();
  const workers: Promise<void>[] = [];

  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (item !== undefined) {
            await worker(item);
          }
        }
      })()
    );
  }

  await Promise.all(workers);
}

// Paginated fetch of recent person IDs from a listable entity.
async function fetchRecentPersonIds(
  listFn: (filters: any, config: any) => Promise<any[]>,
  since: Date,
  dateField: string
): Promise<Set<string>> {
  const personIds = new Set<string>();
  let offset = 0;

  while (true) {
    const page = await listFn(
      { [dateField]: { $gte: since } },
      { skip: offset, take: PAGE_SIZE }
    );

    if (!page || page.length === 0) break;

    for (const row of page) {
      if (row.person_id) personIds.add(row.person_id);
    }

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return personIds;
}

export default async function recalculateScoresJob(container: MedusaContainer) {
  console.log("[AdPlanning] Starting weekly score recalculation job...");

  const adPlanningService: any = container.resolve(AD_PLANNING_MODULE);

  try {
    const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Paginated fetch of person IDs with recent activity
    const conversionPersonIds = await fetchRecentPersonIds(
      (filters, config) =>
        adPlanningService.listConversions(filters, config),
      since,
      "converted_at"
    );

    const journeyPersonIds = await fetchRecentPersonIds(
      (filters, config) =>
        adPlanningService.listCustomerJourneys(filters, config),
      since,
      "event_timestamp"
    );

    const personIds = Array.from(
      new Set([...conversionPersonIds, ...journeyPersonIds])
    );

    console.log(
      `[AdPlanning] Recalculating scores for ${personIds.length} customers with activity in the last ${ACTIVITY_WINDOW_DAYS} days...`
    );

    let processed = 0;
    let errors = 0;

    await processWithConcurrency(personIds, CONCURRENCY, async (personId) => {
      try {
        // Run the three score workflows in parallel for this person —
        // they're independent of each other.
        await Promise.all([
          calculateEngagementWorkflow(container).run({
            input: { person_id: personId },
          }),
          calculateChurnRiskWorkflow(container).run({
            input: { person_id: personId },
          }),
          calculateCLVWorkflow(container).run({
            input: { person_id: personId },
          }),
        ]);

        processed++;

        if (processed % 100 === 0) {
          console.log(
            `[AdPlanning] Processed ${processed}/${personIds.length} customers...`
          );
        }
      } catch (error) {
        errors++;
        console.error(
          `[AdPlanning] Failed to calculate scores for person ${personId}:`,
          error
        );
      }
    });

    console.log(`[AdPlanning] Score recalculation complete:`, {
      total_customers: personIds.length,
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
