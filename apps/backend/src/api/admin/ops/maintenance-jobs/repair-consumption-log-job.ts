import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { CONSUMPTION_LOG_MODULE } from "../../../../modules/consumption_log"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — correct a committed consumption log.
 *
 * A consumption log is write-once in practice: there is a POST to create one
 * and a POST to commit it, and nothing anywhere that edits one. That was fine
 * while committing was pure accounting, and stopped being fine the moment
 * committed logs started moving stock — a log recorded against the wrong
 * location is now a deduction that silently never happens, and there is no way
 * to put it right.
 *
 * The live case: `5210-MUSLIN-100S` is stocked only at Dharamshala
 * (`sloc_01JPAQVG…`), but its log on "Butterfly in muslin" carries
 * `sloc_01KKTXV7…`. The apply job reads that as partner-held and skips it, so
 * 4 m of muslin stays on the books forever.
 *
 * Corrections only — this never creates or deletes a log, and it refuses to
 * touch one whose deduction has already been applied, since the stock movement
 * was computed from the values being changed.
 */

const paramsSchema = z
  .object({
    log_id: z.string().min(1),
    /** Move the log to this stock location. */
    set_location_id: z.string().min(1).optional(),
    /** Correct the recorded quantity. */
    set_quantity: z.number().positive().optional(),
    /** Record what the quantity measures (see #1248). */
    set_quantity_basis: z.enum(["total", "per_piece"]).optional(),
  })
  .refine(
    (v) =>
      v.set_location_id !== undefined ||
      v.set_quantity !== undefined ||
      v.set_quantity_basis !== undefined,
    { message: "nothing to correct — pass at least one set_* parameter" }
  )

/** Stamped by the apply job; its presence means stock already moved. */
const APPLIED_AT_KEY = "inventory_applied_at"

/**
 * Diff the requested corrections against the log as it stands.
 *
 * Pure, so the decision is checkable without a container. A field already at
 * the requested value produces no change rather than a no-op write — the same
 * rule every other job here follows, and what keeps `applied` honest.
 */
export function planConsumptionLogRepair(
  log: Record<string, any>,
  set: {
    location_id?: string
    quantity?: number
    quantity_basis?: "total" | "per_piece"
  }
): MaintenanceChange[] {
  const changes: MaintenanceChange[] = []
  const field = (name: string, after: unknown) => {
    const before = log[name] ?? null
    if (before === after) {
      return
    }
    changes.push({ entity: "consumption_log", id: log.id, field: name, before, after })
  }

  if (set.location_id !== undefined) field("location_id", set.location_id)
  if (set.quantity !== undefined) field("quantity", set.quantity)
  if (set.quantity_basis !== undefined) field("quantity_basis", set.quantity_basis)

  return changes
}

export const repairConsumptionLogJob: MaintenanceJob = {
  id: "repair-consumption-log",
  label: "Correct a consumption log's location, quantity or basis",
  description:
    "Fix a committed consumption log that was recorded wrong — most often at a location the material is not actually stocked at, which makes the apply job skip it as partner-held forever. Corrections only: never creates or deletes a log, and refuses one whose stock deduction has already been applied. Dry-run previews each field.",
  params: [
    {
      name: "log_id",
      type: "string",
      required: true,
      description: "The consumption log to correct, e.g. '01KXQNH5301PBA9H2BF9ZWWAJJ'",
    },
    {
      name: "set_location_id",
      type: "string",
      required: false,
      description:
        "Move the log to this stock location — use the location the material is actually stocked at",
    },
    {
      name: "set_quantity",
      type: "number",
      required: false,
      description: "Correct the recorded quantity",
    },
    {
      name: "set_quantity_basis",
      type: "string",
      required: false,
      description:
        "total | per_piece — what the quantity measures. Legacy logs carry neither and are skipped by the apply job until this is set.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { log_id: logId } = parsed.data

    const service: any = container.resolve(CONSUMPTION_LOG_MODULE)
    const log = await service.retrieveConsumptionLog(logId).catch(() => null)
    if (!log) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Consumption log ${logId} not found`
      )
    }

    // The deduction was computed from these exact values. Editing them after
    // the fact would leave the log describing a movement that never happened,
    // and the idempotency stamp means it will never be re-applied to correct
    // itself. Reverse the stock by hand first if this really needs changing.
    const appliedAt = (log.metadata || {})[APPLIED_AT_KEY]
    if (appliedAt) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Consumption log ${logId} was already applied to inventory at ${appliedAt}. Correcting it now would not move the stock back — reverse the level by hand first, clear metadata.${APPLIED_AT_KEY}, then re-run.`
      )
    }

    const changes = planConsumptionLogRepair(log, {
      location_id: parsed.data.set_location_id,
      quantity: parsed.data.set_quantity,
      quantity_basis: parsed.data.set_quantity_basis,
    })

    if (!dry_run && changes.length > 0) {
      await service.updateConsumptionLogs({
        id: logId,
        ...Object.fromEntries(changes.map((c) => [c.field as string, c.after])),
      })
    }

    const summary = changes.length
      ? `${dry_run ? "Would correct" : "Corrected"} ${changes.length} field(s) on consumption log ${logId}: ${changes
          .map((c) => `${c.field} ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`)
          .join(", ")}`
      : `Consumption log ${logId} already holds the requested values — nothing to correct`

    return {
      job_id: repairConsumptionLogJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
    }
  },
}
