/**
 * GET /admin/marketing/headline
 *
 * The stale-while-revalidate endpoint the headline strip calls (#659 slice 3).
 * Serves the One-Goal hero metric + day-over-day delta + a secondary KPI strip
 * + a trend series, reading ONLY the latest `marketing_metric_snapshot` rows
 * the cron already materialised. Never recomputes and never calls an
 * integration on a page load (report §11.1) — the snapshot table is the
 * durable cache.
 *
 * Empty table → 200 with `headline: null`, `stale: true` (never a 500), so the
 * admin tab can render an empty state before the first cron run.
 *
 * Note: the Redis hot-path read (`cache.ts` `getHeadlineCache()`, slice-3
 * PR-3b / #677) is a fail-soft optimisation layered on top of this Postgres
 * read once that lands on main; the table read here is already the correct,
 * self-sufficient SWR server half.
 *
 * Response (200)
 * { headline: { metric_key, value, unit, dod_delta, as_of_date } | null,
 *   strip: [...KPI rows], trend: [{ as_of_date, value }],
 *   stale: boolean, generated_at }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MARKETING_MODULE } from "../../../../modules/marketing"
import {
  HEADLINE_METRIC_KEY,
  HEADLINE_SCAN_TAKE,
  buildHeadlineResponse,
} from "../marketing-read-lib"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const metricKey =
    (req.query.metric_key as string | undefined) || HEADLINE_METRIC_KEY

  const marketingService: any = req.scope.resolve(MARKETING_MODULE)
  // Scan the most-recent rows once; the pure lib derives the headline, the
  // per-metric strip and the headline trend from this single window.
  const rows = await marketingService.listMarketingMetricSnapshots(
    {},
    {
      take: HEADLINE_SCAN_TAKE,
      order: { captured_for_date: "DESC" },
    }
  )

  res.json(buildHeadlineResponse(rows, metricKey))
}
