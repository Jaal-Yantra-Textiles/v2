import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import {
  reminderPauseOf,
  withReminderPause,
} from "../../../../../workflows/production-runs/lib/reminder-pause"
import { ProductionRunRemindersBody } from "./validators"

/**
 * Pause or resume the daily reminders on ONE run (see reminder-pause.ts).
 * A paused run gets no reminder, no cap re-send and no reassignment from the
 * reminder flow until resumed. The change is written to the run's timeline.
 */
export const POST = async (req: MedusaRequest<ProductionRunRemindersBody>, res: MedusaResponse) => {
  const runId = req.params.id
  const service: ProductionRunService = req.scope.resolve(PRODUCTION_RUNS_MODULE)
  const run = (await service.retrieveProductionRun(runId).catch(() => null)) as any
  if (!run) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Production run ${runId} not found`)
  }
  const { paused, reason } = req.validatedBody
  const actorId = (req as any).auth_context?.actor_id ?? null

  const before = reminderPauseOf(run)
  const pause = paused
    ? before ?? { paused_at: new Date().toISOString(), reason: reason ?? null, by: actorId }
    : null

  if (!!before !== paused) {
    await service.updateProductionRuns({ id: runId, metadata: withReminderPause(run.metadata, pause) } as any)
    await service.createProductionRunActivities({
      production_run_id: runId,
      activity_type: "note",
      kind: paused ? "reminders_paused" : "reminders_resumed",
      actor_type: "admin",
      actor_id: actorId,
      partner_id: run.partner_id ?? null,
      channel: null,
      message_id: null,
      template_name: null,
      recipient: null,
      summary: paused
        ? `Reminders paused${reason ? `: ${reason}` : ""}`
        : `Reminders resumed${reason ? `: ${reason}` : ""}`,
      payload: { reason: reason ?? null },
      occurred_at: new Date(),
    } as any)
  }

  const after = (await service.retrieveProductionRun(runId)) as any
  res.status(200).json({ production_run_id: runId, reminders_paused: reminderPauseOf(after) })
}
