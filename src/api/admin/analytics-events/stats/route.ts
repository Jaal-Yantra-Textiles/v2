import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getAnalyticsStatsWorkflow } from "../../../../workflows/analytics/reports/get-analytics-stats";

/**
 * GET /admin/analytics-events/stats
 * 
 * Get aggregated analytics statistics for a website.
 * 
 * Query params:
 * - website_id: Website ID (required)
 * - start_date: Start date (ISO string, optional)
 * - end_date: End date (ISO string, optional)
 * - days: Number of days to include (alternative to start_date/end_date)
 * 
 * Examples:
 * - Last 30 days: ?website_id=abc&days=30
 * - Custom range: ?website_id=abc&start_date=2024-01-01&end_date=2024-01-31
 * - All time: ?website_id=abc
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { website_id, start_date, end_date, days } = req.query;

  if (!website_id) {
    return res.status(400).json({
      error: "website_id is required"
    });
  }

  // Calculate date range
  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (days) {
    const daysNum = parseInt(days as string);
    startDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
    endDate = new Date();
  } else {
    if (start_date) startDate = new Date(start_date as string);
    if (end_date) endDate = new Date(end_date as string);
  }

  const { result } = await getAnalyticsStatsWorkflow(req.scope).run({
    input: {
      website_id: website_id as string,
      start_date: startDate,
      end_date: endDate,
    },
  });

  res.json({
    website_id,
    period: {
      start_date: startDate?.toISOString(),
      end_date: endDate?.toISOString(),
      days: days ? parseInt(days as string) : undefined,
    },
    stats: result,
  });
};
