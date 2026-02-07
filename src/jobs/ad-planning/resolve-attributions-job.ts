/**
 * Resolve Attributions Job
 *
 * Daily job to batch resolve unattributed sessions.
 * Runs at 2 AM.
 */

import { MedusaContainer } from "@medusajs/framework";
import { bulkResolveAttributionsWorkflow } from "../../workflows/ad-planning/attribution/bulk-resolve-attributions";

export default async function resolveAttributionsJob(container: MedusaContainer) {
  console.log("[AdPlanning] Starting daily attribution resolution job...");

  try {
    const result = await bulkResolveAttributionsWorkflow(container).run({
      input: {
        days_back: 7,
        limit: 5000,
      },
    });

    console.log(`[AdPlanning] Attribution resolution complete:`, {
      processed: result.result.processed,
      resolved: result.result.resolved,
      failed: result.result.failed,
    });
  } catch (error) {
    console.error("[AdPlanning] Attribution resolution job failed:", error);
  }
}

export const config = {
  name: "resolve-attributions",
  schedule: "0 2 * * *", // 2 AM daily
};
