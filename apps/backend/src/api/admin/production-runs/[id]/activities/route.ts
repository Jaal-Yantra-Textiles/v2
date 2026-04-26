import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"

/**
 * GET /admin/production-runs/:id/activities
 *
 * Returns the activity stream for a production run — lifecycle transitions,
 * reminder dispatches, and any future activity types — ordered newest first.
 *
 * Query:
 *   limit            number (default 100, max 500)
 *   offset           number (default 0)
 *   activity_type    "reminder_sent" | "lifecycle_event" | "note" | "system"
 *   kind             specific kind to filter by (e.g. "assignment_pending")
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const runId = req.params.id

  const service: ProductionRunService = req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const run = await service.retrieveProductionRun(runId).catch(() => null)
  if (!run) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${runId} not found`
    )
  }

  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100))
  const offset = Math.max(0, Number(req.query.offset) || 0)

  const filters: Record<string, any> = { production_run_id: runId }
  if (typeof req.query.activity_type === "string") {
    filters.activity_type = req.query.activity_type
  }
  if (typeof req.query.kind === "string") {
    filters.kind = req.query.kind
  }

  const [activities, count] = await service.listAndCountProductionRunActivities(
    filters as any,
    {
      take: limit,
      skip: offset,
      order: { occurred_at: "DESC" },
    } as any
  )

  res.status(200).json({
    activities,
    count,
    limit,
    offset,
  })
}
