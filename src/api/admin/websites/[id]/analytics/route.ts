import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getWebsiteAnalyticsOverviewWorkflow } from "../../../../../workflows/analytics/get-website-analytics-overview";

/**
 * GET /admin/websites/:id/analytics
 * 
 * Get analytics overview for a website using the read-only module link.
 * This demonstrates the power of graph queries - single query gets website + analytics!
 * 
 * Query params:
 * - days: Number of days to include (default: 30)
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params;
  const days = parseInt(req.query.days as string) || 30;

  const { result } = await getWebsiteAnalyticsOverviewWorkflow(req.scope).run({
    input: {
      website_id: id,
      days,
    },
  });

  res.json(result);
};
