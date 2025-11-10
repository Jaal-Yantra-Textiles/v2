import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getAnalyticsTimeseriesWorkflow } from "../../../../workflows/analytics/reports/get-analytics-timeseries";

/**
 * GET /admin/analytics-events/timeseries
 * 
 * Get time-series data for analytics charts.
 * 
 * Query params:
 * - website_id: Website ID (required)
 * - start_date: Start date (ISO string, required)
 * - end_date: End date (ISO string, required)
 * - interval: "hour" or "day" (default: "day")
 * 
 * Examples:
 * - Daily for last 30 days: ?website_id=abc&days=30&interval=day
 * - Hourly for last 24 hours: ?website_id=abc&days=1&interval=hour
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { website_id, start_date, end_date, days, interval } = req.query;

  if (!website_id) {
    return res.status(400).json({
      error: "website_id is required"
    });
  }

  // Calculate date range
  let startDate: Date;
  let endDate: Date;

  if (days) {
    const daysNum = parseInt(days as string);
    startDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
    endDate = new Date();
  } else if (start_date && end_date) {
    startDate = new Date(start_date as string);
    endDate = new Date(end_date as string);
  } else {
    return res.status(400).json({
      error: "Either 'days' or both 'start_date' and 'end_date' are required"
    });
  }

  const { result } = await getAnalyticsTimeseriesWorkflow(req.scope).run({
    input: {
      website_id: website_id as string,
      start_date: startDate,
      end_date: endDate,
      interval: (interval as "hour" | "day") || "day",
    },
  });

  res.json({
    website_id,
    period: {
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      interval: interval || "day",
    },
    data: result,
  });
};
