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
 *
 * Query params:
 * - days: Number of days to include (default: 30)
 * - from: ISO date string — start of range (overrides days)
 * - to: ISO date string — end of range (defaults to now)
 * - utm_source, utm_medium, utm_campaign: UTM filter strings
 * - pathname: Substring match on pathname
 * - qr_key: Query param key to find in query_string
 * - qr_value: Corresponding value for qr_key
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params;
  const q = req.query as Record<string, string>;
  const days = parseInt(q.days) || 30;

  const { result } = await getWebsiteAnalyticsOverviewWorkflow(req.scope).run({
    input: {
      website_id: id,
      days,
      from: q.from || undefined,
      to: q.to || undefined,
      utm_source: q.utm_source || undefined,
      utm_medium: q.utm_medium || undefined,
      utm_campaign: q.utm_campaign || undefined,
      pathname: q.pathname || undefined,
      qr_key: q.qr_key || undefined,
      qr_value: q.qr_value || undefined,
    },
  });

  res.json(result);
};
