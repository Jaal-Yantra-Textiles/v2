/**
 * @file Admin API routes for retrieving time-series analytics data
 * @description Provides endpoints for fetching analytics data to power charts and trend views in the JYT Commerce platform
 * @module API/Admin/Analytics
 */

/**
 * @typedef {Object} AnalyticsTimeseriesQueryParams
 * @property {string} website_id - The website identifier to query analytics for (required)
 * @property {number} [days] - If provided, the range is computed as [now - days, now]
 * @property {string} [start_date] - Inclusive start of the period (ISO string, required if `days` not provided)
 * @property {string} [end_date] - Inclusive end of the period (ISO string, required if `days` not provided)
 * @property {"hour"|"day"} [interval="day"] - Granularity of returned buckets
 */

/**
 * @typedef {Object} AnalyticsTimeseriesResponse
 * @property {string} website_id - The website identifier
 * @property {Object} period - The time period for the analytics data
 * @property {string} period.start_date - Start date of the period (ISO string)
 * @property {string} period.end_date - End date of the period (ISO string)
 * @property {"hour"|"day"} period.interval - Granularity of the data points
 * @property {Array<Object>} data - Array of analytics data points
 * @property {string} data[].timestamp - Timestamp of the data point (ISO string)
 * @property {number} data[].value - Value of the metric at this timestamp
 * @property {Object} [data[].metricFields] - Additional metric-specific fields
 */

/**
 * Retrieve time-series analytics data for a website
 * @route GET /admin/analytics-events/timeseries
 * @group Analytics - Operations related to analytics data
 * @param {string} website_id.query.required - The website identifier to query analytics for
 * @param {number} [days.query] - Number of days to look back from current time
 * @param {string} [start_date.query] - Start date of the period (ISO string)
 * @param {string} [end_date.query] - End date of the period (ISO string)
 * @param {"hour"|"day"} [interval.query="day"] - Granularity of returned buckets
 * @returns {AnalyticsTimeseriesResponse} 200 - Time-series analytics data
 * @throws {MedusaError} 400 - Missing `website_id`, or missing/invalid date range
 * @throws {MedusaError} 500 - Workflow or server error while fetching analytics
 *
 * @example request
 * GET /admin/analytics-events/timeseries?website_id=web_123&days=30&interval=day
 *
 * @example response 200
 * {
 *   "website_id": "web_123",
 *   "period": {
 *     "start_date": "2025-01-01T00:00:00.000Z",
 *     "end_date": "2025-01-31T23:59:59.999Z",
 *     "interval": "day"
 *   },
 *   "data": [
 *     { "timestamp": "2025-01-01T00:00:00.000Z", "count": 123 },
 *     { "timestamp": "2025-01-02T00:00:00.000Z", "count": 98 }
 *   ]
 * }
 *
 * @example request (hourly)
 * GET /admin/analytics-events/timeseries?website_id=web_456&days=1&interval=hour
 *
 * @example response 200 (hourly)
 * {
 *   "website_id": "web_456",
 *   "period": {
 *     "start_date": "2025-02-01T00:00:00.000Z",
 *     "end_date": "2025-02-01T23:59:59.999Z",
 *     "interval": "hour"
 *   },
 *   "data": [
 *     { "timestamp": "2025-02-01T00:00:00.000Z", "count": 45 },
 *     { "timestamp": "2025-02-01T01:00:00.000Z", "count": 32 }
 *   ]
 * }
 *
 * @example request (custom date range)
 * GET /admin/analytics-events/timeseries?website_id=web_789&start_date=2025-01-01T00:00:00.000Z&end_date=2025-01-07T23:59:59.999Z&interval=day
 *
 * @example response 200 (custom date range)
 * {
 *   "website_id": "web_789",
 *   "period": {
 *     "start_date": "2025-01-01T00:00:00.000Z",
 *     "end_date": "2025-01-07T23:59:59.999Z",
 *     "interval": "day"
 *   },
 *   "data": [
 *     { "timestamp": "2025-01-01T00:00:00.000Z", "count": 200 },
 *     { "timestamp": "2025-01-02T00:00:00.000Z", "count": 180 }
 *   ]
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getAnalyticsTimeseriesWorkflow } from "../../../../workflows/analytics/reports/get-analytics-timeseries";

/**
 * GET /admin/analytics-events/timeseries
 *
 * Retrieve time-series analytics data for a website to power charts and trend views.
 *
 * Query parameters:
 * - website_id: string (required) — The website identifier to query analytics for.
 * - days: number (optional) — If provided, the range is computed as [now - days, now].
 * - start_date: string (ISO) (required if `days` not provided) — Inclusive start of the period.
 * - end_date: string (ISO) (required if `days` not provided) — Inclusive end of the period.
 * - interval: "hour" | "day" (optional, default: "day") — Granularity of returned buckets.
 *
 * Behavior:
 * - If `days` is present, `start_date` is calculated as current time minus `days` days and `end_date` is now.
 * - Otherwise both `start_date` and `end_date` must be provided and parseable as ISO dates.
 *
 * Responses:
 * - 200 OK: JSON object containing:
 *     {
 *       website_id: string,
 *       period: {
 *         start_date: string (ISO),
 *         end_date: string (ISO),
 *         interval: "hour" | "day"
 *       },
 *       data: any // result returned by the analytics timeseries workflow (typically an array of datapoints)
 *     }
 * - 400 Bad Request: Missing `website_id`, or missing/invalid date range (`days` or both `start_date` and `end_date`).
 * - 500 Internal Server Error: Workflow or server error while fetching analytics.
 *
 * Data shape:
 * - The `data` payload is produced by the internal `getAnalyticsTimeseriesWorkflow`. A common shape is an array
 *   of datapoints: [{ timestamp: string (ISO), value: number, ...metricFields }]
 *
 * Example requests:
 * - Daily for last 30 days:
 *   GET /admin/analytics-events/timeseries?website_id=abc&days=30&interval=day
 *
 * - Hourly for last 24 hours:
 *   GET /admin/analytics-events/timeseries?website_id=abc&days=1&interval=hour
 *
 * Example curl:
 * curl -X GET "https://api.example.com/admin/analytics-events/timeseries?website_id=abc&days=30&interval=day" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -H "Content-Type: application/json"
 *
 * Example successful response (200):
 * {
 *   "website_id": "abc",
 *   "period": {
 *     "start_date": "2025-01-01T00:00:00.000Z",
 *     "end_date": "2025-01-31T23:59:59.999Z",
 *     "interval": "day"
 *   },
 *   "data": [
 *     { "timestamp": "2025-01-01T00:00:00.000Z", "count": 123 },
 *     { "timestamp": "2025-01-02T00:00:00.000Z", "count": 98 }
 *   ]
 * }
 *
 * @param req - MedusaRequest containing query parameters and scoped services.
 * @param res - MedusaResponse used to emit the JSON response and status codes.
 * @returns Promise<void> that resolves after sending the HTTP response.
 * Overview: 
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
