/**
 * Admin Attribution Resolution API
 * Trigger attribution resolution workflows
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { resolveSessionAttributionWorkflow } from "../../../../../workflows/ad-planning/attribution/resolve-session-attribution";
import { bulkResolveAttributionsWorkflow } from "../../../../../workflows/ad-planning/attribution/bulk-resolve-attributions";

const ResolveSessionSchema = z.object({
  session_id: z.string(),
  website_id: z.string().optional(),
});

const BulkResolveSchema = z.object({
  days_back: z.number().default(7),
  website_id: z.string().optional(),
  limit: z.number().default(1000),
});

/**
 * Resolve attribution for a single session
 * @route POST /admin/ad-planning/attribution/resolve
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.body as Record<string, any>;

  // Check if this is a bulk request
  if (body.bulk === true || body.days_back !== undefined) {
    // Bulk resolve
    const data = BulkResolveSchema.parse(body);

    const result = await bulkResolveAttributionsWorkflow(req.scope).run({
      input: data,
    });

    res.json({
      success: true,
      ...result.result,
    });
  } else {
    // Single session resolve
    const data = ResolveSessionSchema.parse(body);

    const result = await resolveSessionAttributionWorkflow(req.scope).run({
      input: data,
    });

    res.json({
      success: true,
      attribution: result.result.attribution,
      resolved: result.result.resolved,
    });
  }
};
