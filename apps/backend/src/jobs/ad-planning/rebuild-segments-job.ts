/**
 * Rebuild Segments Job
 *
 * Daily job to rebuild dynamic customer segments.
 * Runs at 4 AM.
 */

import { MedusaContainer } from "@medusajs/framework";
import { AD_PLANNING_MODULE } from "../../modules/ad-planning";
import { buildSegmentWorkflow } from "../../workflows/ad-planning/segments/build-segment";

export default async function rebuildSegmentsJob(container: MedusaContainer) {
  console.log("[AdPlanning] Starting daily segment rebuild job...");

  const adPlanningService = container.resolve(AD_PLANNING_MODULE);

  try {
    // Get all active dynamic segments
    const segments = await adPlanningService.listCustomerSegments({
      is_active: true,
    });

    // Filter to dynamic segments (auto_update = true)
    const dynamicSegments = segments.filter(
      (s: any) => s.auto_update !== false
    );

    console.log(`[AdPlanning] Rebuilding ${dynamicSegments.length} dynamic segments...`);

    let processed = 0;
    let errors = 0;

    for (const segment of dynamicSegments) {
      try {
        const result = await buildSegmentWorkflow(container).run({
          input: { segment_id: segment.id },
        });

        console.log(`[AdPlanning] Rebuilt segment "${segment.name}":`, {
          total_evaluated: result.result.total_evaluated,
          matching_count: result.result.matching_count,
          members_added: result.result.members_added,
          members_removed: result.result.members_removed,
        });

        processed++;
      } catch (error) {
        errors++;
        console.error(`[AdPlanning] Failed to rebuild segment "${segment.name}":`, error);
      }
    }

    console.log(`[AdPlanning] Segment rebuild complete:`, {
      total_segments: dynamicSegments.length,
      processed,
      errors,
    });
  } catch (error) {
    console.error("[AdPlanning] Segment rebuild job failed:", error);
  }
}

export const config = {
  name: "rebuild-customer-segments",
  schedule: "0 4 * * *", // 4 AM daily
};
