/**
 * Example usage:
 *
 * // Get analytics for website "web_123" over last 30 days (default)
 * GET /admin/websites/web_123/analytics
 *
 * // Get analytics for website "web_123" over last 7 days
 * GET /admin/websites/web_123/analytics?days=7
 *
 * // Get analytics for website "web_123" over last 90 days
 * GET /admin/websites/web_123/analytics?days=90
 *
 * Response structure:
 * {
 *   website: {
 *     id: string,
 *     name: string,
 *     // ... other website fields
 *   },
 *   analytics: {
 *     total_visits: number,
 *     unique_visitors: number,
 *     conversion_rate: number,
 *     // ... other analytics metrics
 *   }
 * }
 */
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
