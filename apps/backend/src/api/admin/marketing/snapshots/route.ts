/**
 * GET /admin/marketing/snapshots
 *
 * Append-only metric snapshot rows over a window (#659 slice 3). Powers the
 * trend line and a future drill-down table on the marketing admin tab. Reads
 * ONLY the `marketing_metric_snapshot` table — the table IS the durable cache
 * (materialised daily by `jobs/marketing-daily-refresh.ts`), so no integration
 * call ever happens on a page load (report §11.1).
 *
 * Query parameters
 * - metric_key (string, optional): equality filter on the metric.
 * - days (number, optional): rolling window on captured_for_date; takes
 *   precedence over start_date/end_date.
 * - start_date / end_date (ISO string, optional): explicit window.
 * - limit (number, optional): page size (default 100, capped 500).
 * - offset (number, optional): page offset (default 0).
 *
 * Response (200)
 * { snapshots: [...], count, limit, offset, metric_key, period: { start_date?, end_date? } }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MARKETING_MODULE } from "../../../../modules/marketing"
import { parseSnapshotQuery } from "../marketing-read-lib"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { metric_key, startDate, endDate, limit, offset } = parseSnapshotQuery(
    req.query as Record<string, unknown>
  )

  const filters: Record<string, unknown> = {}
  if (metric_key) filters.metric_key = metric_key
  if (startDate || endDate) {
    const range: Record<string, Date> = {}
    if (startDate) range.$gte = startDate
    if (endDate) range.$lte = endDate
    filters.captured_for_date = range
  }

  const marketingService: any = req.scope.resolve(MARKETING_MODULE)
  const [snapshots, count] =
    await marketingService.listAndCountMarketingMetricSnapshots(filters, {
      take: limit,
      skip: offset,
      order: { captured_for_date: "DESC" },
    })

  res.json({
    snapshots,
    count,
    limit,
    offset,
    metric_key: metric_key ?? null,
    period: {
      start_date: startDate?.toISOString(),
      end_date: endDate?.toISOString(),
    },
  })
}
