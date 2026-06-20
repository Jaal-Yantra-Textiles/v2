/**
 * GET /admin/websites/:id/analytics/outbound
 *
 * Ranked breakdown of a website's outbound link clicks (#569 S5a). The client
 * tracks external-host `<a>` clicks as `link_out` custom events carrying the
 * destination URL under `metadata.href`; this groups them by href.
 *
 * Query parameters
 * - days (number, optional): rolling window; takes precedence over
 *   start_date/end_date when present.
 * - start_date / end_date (ISO string, optional): explicit window.
 * - limit (number, optional): max buckets (default 20, capped 100).
 *
 * Response (200)
 * {
 *   website_id,
 *   period: { start_date?, end_date?, days? },
 *   outbound_links: { total_events, total_unique_visitors, results: [{ value, count, unique_visitors, percentage }] }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getOutboundLinksWorkflow } from "../../../../../../workflows/analytics/reports/get-outbound-links";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const { start_date, end_date, days, limit } = req.query;

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

  const { result } = await getOutboundLinksWorkflow(req.scope).run({
    input: {
      website_id: id,
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
    outbound_links: result,
  });
};
