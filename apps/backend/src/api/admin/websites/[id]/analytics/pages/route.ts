/**
 * GET /admin/websites/:id/analytics/pages
 *
 * Ranked breakdown of a website's analytics sessions by their entry (landing)
 * and/or exit page (#569 S2). Sessions are scoped by website + an optional date
 * range. The response mirrors the events breakdown envelope but counts
 * sessions.
 *
 * Query parameters
 * - dimension (string, optional): one of `entry_page` | `exit_page`. When
 *   omitted, BOTH breakdowns are returned. 400 if present but unknown.
 * - days (number, optional): rolling window; takes precedence over
 *   start_date/end_date when present.
 * - start_date / end_date (ISO string, optional): explicit window.
 * - limit (number, optional): max buckets per breakdown (default 20, capped 100).
 *
 * Response (200)
 * {
 *   website_id,
 *   period: { start_date?, end_date?, days? },
 *   pages: {
 *     entry_page?: { dimension, total_sessions, total_unique_visitors, results: [...] },
 *     exit_page?:  { dimension, total_sessions, total_unique_visitors, results: [...] }
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getSessionPagesWorkflow } from "../../../../../../workflows/analytics/reports/get-session-pages";
import {
  isSessionPageDimension,
  SESSION_PAGE_DIMENSIONS,
  type SessionPageDimension,
} from "../../../../../../workflows/analytics/reports/session-pages-lib";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const { dimension, start_date, end_date, days, limit } = req.query;

  let dimensions: SessionPageDimension[] = SESSION_PAGE_DIMENSIONS;
  if (dimension !== undefined && dimension !== "") {
    if (!isSessionPageDimension(dimension)) {
      return res.status(400).json({
        error: "dimension must be one of the supported session page dimensions",
        supported_dimensions: SESSION_PAGE_DIMENSIONS,
      });
    }
    dimensions = [dimension];
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

  const { result } = await getSessionPagesWorkflow(req.scope).run({
    input: {
      website_id: id,
      dimensions,
      start_date: startDate,
      end_date: endDate,
      limit: Number.isNaN(parsedLimit as number) ? undefined : parsedLimit,
    },
  });

  res.json({
    website_id: id,
    period: {
      start_date: startDate?.toISOString(),
      end_date: endDate?.toISOString(),
      days: days ? parseInt(days as string, 10) : undefined,
    },
    pages: result,
  });
};
