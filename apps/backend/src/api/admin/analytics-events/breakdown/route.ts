/**
 * GET /admin/analytics-events/breakdown
 *
 * Single-dimension granular breakdown of a website's analytics events, with
 * composable equality filters and a date range (#559 slice 3).
 *
 * Query parameters
 * - website_id (string, required): website to report on. 400 if missing.
 * - dimension (string, required): one of BREAKDOWN_DIMENSIONS (country,
 *   device_type, browser, os, referrer_source, utm_source, utm_medium,
 *   utm_campaign, utm_term, utm_content, pathname, is_404, event_type,
 *   event_name). 400 if missing/unknown.
 * - days (number, optional): rolling window; takes precedence over
 *   start_date/end_date when present.
 * - start_date / end_date (ISO string, optional): explicit window.
 * - limit (number, optional): max buckets returned (default 20, capped 100).
 * - <filterable field>=<value> (optional, repeatable): any FILTERABLE_FIELD
 *   passed as a query key becomes an equality filter, e.g.
 *   `?dimension=pathname&device_type=mobile&country=IN`. Null rows are matched
 *   by their canonical label (e.g. `referrer_source=direct`).
 *
 * Response (200)
 * {
 *   website_id, dimension,
 *   period: { start_date?, end_date?, days? },
 *   filters: { ...applied equality filters },
 *   breakdown: { dimension, total_events, total_unique_visitors, results: [...] }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getAnalyticsBreakdownWorkflow } from "../../../../workflows/analytics/reports/get-analytics-breakdown";
import {
  BREAKDOWN_DIMENSIONS,
  FILTERABLE_FIELDS,
  isBreakdownDimension,
  isFilterableField,
} from "../../../../workflows/analytics/reports/breakdown-lib";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { website_id, dimension, start_date, end_date, days, limit } = req.query;

  if (!website_id) {
    return res.status(400).json({ error: "website_id is required" });
  }

  if (!isBreakdownDimension(dimension)) {
    return res.status(400).json({
      error: "dimension is required and must be one of the supported dimensions",
      supported_dimensions: BREAKDOWN_DIMENSIONS,
    });
  }

  // Collect composable equality filters (any filterable field present in query).
  const filters: Record<string, string> = {};
  for (const field of FILTERABLE_FIELDS) {
    const raw = req.query[field];
    if (isFilterableField(field) && raw !== undefined && raw !== "") {
      filters[field] = Array.isArray(raw) ? String(raw[0]) : String(raw);
    }
  }

  // Resolve date window.
  let startDate: Date | undefined;
  let endDate: Date | undefined;
  if (days) {
    const daysNum = parseInt(days as string, 10);
    if (!Number.isNaN(daysNum)) {
      startDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
      endDate = new Date();
    }
  } else {
    if (start_date) startDate = new Date(start_date as string);
    if (end_date) endDate = new Date(end_date as string);
  }

  const parsedLimit = limit ? parseInt(limit as string, 10) : undefined;

  const { result } = await getAnalyticsBreakdownWorkflow(req.scope).run({
    input: {
      website_id: website_id as string,
      dimension,
      start_date: startDate,
      end_date: endDate,
      filters,
      limit: Number.isNaN(parsedLimit as number) ? undefined : parsedLimit,
    },
  });

  res.json({
    website_id,
    dimension,
    period: {
      start_date: startDate?.toISOString(),
      end_date: endDate?.toISOString(),
      days: days ? parseInt(days as string, 10) : undefined,
    },
    filters,
    breakdown: result,
  });
};
