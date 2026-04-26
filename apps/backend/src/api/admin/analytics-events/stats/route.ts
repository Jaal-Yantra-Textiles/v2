/**
 * GET /admin/analytics-events/stats
 *
 * Retrieve aggregated analytics statistics for a specific website over a requested time range.
 *
 * Query parameters
 * - website_id (string, required): The ID of the website for which stats are requested. If omitted,
 *   the handler responds with HTTP 400.
 * - start_date (string, optional): ISO-8601 date/time string that marks the inclusive start of the
 *   reporting period (e.g. "2024-01-01T00:00:00Z"). Only used when `days` is not provided.
 * - end_date (string, optional): ISO-8601 date/time string that marks the inclusive end of the
 *   reporting period. Only used when `days` is not provided.
 * - days (number|string, optional): Number of days in the past to use as the reporting window.
 *   When provided, it takes precedence over `start_date`/`end_date`. e.g. days=7 sets start_date
 *   to now - 7 days and end_date to now.
 *
 * Behavior / Notes
 * - Validates presence of website_id and returns 400 { error: "website_id is required" } if missing.
 * - If `days` is provided it is parsed as an integer; start_date is computed as (now - days) and
 *   end_date is set to now.
 * - If `days` is not provided, `start_date` and `end_date` are parsed from the query as Date objects.
 *   (Invalid date strings will produce an Invalid Date object; callers should provide valid ISO dates.)
 * - Calls getAnalyticsStatsWorkflow(req.scope).run({ input: { website_id, start_date, end_date } })
 *   to obtain the statistics payload.
 * - Returns a JSON response describing the requested period and the workflow result.
 *
 * Successful response (200)
 * {
 *   website_id: string,
 *   period: {
 *     start_date?: string, // ISO timestamp or undefined
 *     end_date?: string,   // ISO timestamp or undefined
 *     days?: number        // provided days parsed to number, if present
 *   },
 *   stats: any            // result returned by getAnalyticsStatsWorkflow
 * }
 *
 * Possible status codes
 * - 200: OK — stats returned
 * - 400: Bad Request — missing required website_id
 * - 5xx: Internal Server Error — workflow failure or unexpected error
 *
 * @param req - MedusaRequest whose query must contain `website_id` and may contain `start_date`, `end_date`, or `days`.
 * @param res - MedusaResponse used to send JSON responses and appropriate HTTP status codes.
 * @returns Promise<void> — writes the HTTP response (does not return value).
 * @throws Error if the underlying analytics workflow fails or an unexpected error occurs while processing the request.
 *
 * @example
 * // By days:
 * GET /admin/analytics-events/stats?website_id=site_123&days=7
 *
 * @example
 * // By explicit range:
 * GET /admin/analytics-events/stats?website_id=site_123&start_date=2024-01-01T00:00:00Z&end_date=2024-01-07T23:59:59Z
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getAnalyticsStatsWorkflow } from "../../../../workflows/analytics/reports/get-analytics-stats";


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
