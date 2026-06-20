/**
 * GET /admin/websites/:id/analytics/sessions
 *
 * Paginated list of a website's analytics sessions (#569 S7a). Powers the
 * "Sessions" tab of the analytics dashboard v2.
 *
 * Query parameters
 * - days (number, optional): rolling window over `started_at`; takes precedence
 *   over start_date/end_date when present.
 * - start_date / end_date (ISO string, optional): explicit window over
 *   `started_at`.
 * - limit (number, optional): page size (default 20, capped 100).
 * - offset (number, optional): rows to skip (default 0).
 * - order_by (string, optional): one of started_at | last_activity_at |
 *   ended_at | duration_seconds | pageviews (default started_at; unknown →
 *   started_at).
 * - order_dir (string, optional): ASC | DESC (default DESC).
 *
 * Response (200)
 * {
 *   website_id,
 *   period: { start_date?, end_date?, days? },
 *   limit, offset, count,
 *   sessions: [ { id, session_id, visitor_id, entry_page, exit_page,
 *                 pageviews, duration_seconds, is_bounce, referrer,
 *                 referrer_source, country, device_type, browser, os,
 *                 utm_*, started_at, ended_at, last_activity_at } ]
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getWebsiteSessionsWorkflow } from "../../../../../../workflows/analytics/reports/get-website-sessions";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const { days, start_date, end_date, limit, offset, order_by, order_dir } =
    req.query as Record<string, string>;

  // Resolve date window — `days` wins over explicit start/end.
  let startDate: Date | undefined;
  let endDate: Date | undefined;
  if (days) {
    const daysNum = parseInt(days, 10);
    if (!Number.isNaN(daysNum)) {
      startDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
      endDate = new Date();
    }
  } else {
    if (start_date) startDate = new Date(start_date);
    if (end_date) endDate = new Date(end_date);
  }

  const { result } = await getWebsiteSessionsWorkflow(req.scope).run({
    input: {
      website_id: id,
      start_date: startDate,
      end_date: endDate,
      limit,
      offset,
      order_by,
      order_dir,
    },
  });

  res.json({
    website_id: id,
    period: {
      start_date: startDate?.toISOString(),
      end_date: endDate?.toISOString(),
      days: days ? parseInt(days, 10) : undefined,
    },
    limit: result.limit,
    offset: result.offset,
    count: result.count,
    sessions: result.sessions,
  });
};
