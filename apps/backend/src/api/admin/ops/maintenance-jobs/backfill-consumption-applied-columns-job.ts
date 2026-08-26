import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { CONSUMPTION_LOG_MODULE } from "../../../../modules/consumption_log"
import {
  APPLIED_AT_KEY,
  APPLIED_LOCATION_KEY,
} from "../../../../workflows/consumption-logs/lib/apply-to-inventory"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — move the inventory-apply stamp out of `metadata` and into its
 * own columns.
 *
 * ## Why the stamp could not stay in a JSON blob
 *
 * `metadata.inventory_applied_at` is the idempotency guard for stock
 * deduction: `apply-committed-consumption-to-inventory` skips any log carrying
 * it. Inside `metadata` that guard survived only because every writer
 * remembered to spread the existing object first. It is a convention, and the
 * codebase already contains update routes of the shape
 * `metadata: body.metadata` — one of those pointed at a consumption log would
 * have erased the stamp without erroring, and the next apply run would have
 * taken the same material off the shelf a second time.
 *
 * Nothing about that failure is loud. The log still reads as committed, the
 * stock simply goes down twice.
 *
 * ## What this job does, and what it refuses to do
 *
 * `Migration20260826180000` already copies the legacy keys into the columns, so
 * on a freshly-migrated database this job finds nothing. It exists for the rows
 * that drift back: a log written by an older worker mid-deploy, or one whose
 * metadata was edited after the migration ran.
 *
 * 🔴 It only ever fills a NULL column from metadata. It will not overwrite a
 * column that already holds a value, and it will not clear the metadata keys.
 * Both restraints protect the same thing: while the apply job still writes both
 * (deliberately, so a code rollback cannot resurrect the double-deduction),
 * deleting the legacy key would strand a rolled-back reader with no stamp at
 * all — which is precisely the double-deduction this whole change exists to
 * prevent.
 *
 * A row whose column and metadata DISAGREE is reported and never touched. The
 * two values are both claims about when money-equivalent stock moved, and
 * picking one by rule would be inventing a fact about a warehouse.
 */

/** Hard cap per call — bounds the scan. */
export const MAX_APPLIED_BACKFILL_SCAN = 5000

const paramsSchema = z.object({
  /** Restrict to one design's logs. */
  design_id: z.string().min(1).optional(),
  /** Restrict to one log — the safe way to settle a single disagreement. */
  log_id: z.string().min(1).optional(),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_APPLIED_BACKFILL_SCAN)
    .optional()
    .default(1000),
})

export type AppliedBackfillVerdict =
  /** Column already set and metadata agrees (or is absent). Nothing to do. */
  | "already_migrated"
  /** Column null, metadata carries a stamp → fill the column. */
  | "fill"
  /** Neither carries a stamp. The log was never applied. */
  | "never_applied"
  /** Column and metadata both set, to DIFFERENT values. Reported, never touched. */
  | "conflict"

/**
 * PURE: what one log needs, given its column and its legacy metadata.
 *
 * 🔑 Timestamps are compared as instants, not strings. The column round-trips
 * through a `timestamptz` and comes back as a Date whose ISO form carries
 * milliseconds and a `Z`; the metadata value is whatever string the apply job
 * wrote. `"2026-08-15T06:37:24.597Z"` and that same moment as a Date are the
 * same fact, and a string comparison would call every migrated row a conflict.
 */
export function classifyAppliedBackfill(input: {
  column_at: string | Date | null | undefined
  metadata_at: string | Date | null | undefined
}): { verdict: AppliedBackfillVerdict } {
  const instant = (v: string | Date | null | undefined): number | null => {
    if (v === null || v === undefined || v === "") return null
    const t = new Date(v as any).getTime()
    return Number.isFinite(t) ? t : null
  }

  const col = instant(input.column_at)
  const meta = instant(input.metadata_at)

  if (col === null && meta === null) return { verdict: "never_applied" }
  if (col === null) return { verdict: "fill" }
  if (meta === null) return { verdict: "already_migrated" }
  return { verdict: col === meta ? "already_migrated" : "conflict" }
}

export const backfillConsumptionAppliedColumnsJob: MaintenanceJob = {
  id: "backfill-consumption-applied-columns",
  label: "Backfill consumption inventory-applied columns from metadata",
  description:
    `Copy the inventory-apply stamp from consumption_log.metadata into the inventory_applied_at / inventory_applied_location_id COLUMNS. That stamp is the idempotency guard for stock deduction — the apply job skips any log carrying it — and inside a JSON blob it survived only by every writer remembering to spread the existing object, so one wholesale 'metadata: body.metadata' write would have cleared it silently and the next apply run would have deducted the same material twice. Migration20260826180000 already copies existing rows; this catches anything that drifts back (a log written by an older worker mid-deploy, or metadata edited afterwards). Only ever fills a NULL column and NEVER clears the metadata keys — the apply job still writes both so a code rollback cannot resurrect the double-deduction, and deleting the legacy key would strand a rolled-back reader with no stamp at all. A log whose column and metadata disagree is reported as a conflict and never touched: both are claims about when stock moved, and choosing one by rule would invent a fact about a warehouse. Dry-run previews every fill; apply persists. Scans up to 'limit' logs per call (default 1000, max ${MAX_APPLIED_BACKFILL_SCAN}).`,
  params: [
    {
      name: "design_id",
      type: "string",
      required: false,
      description: "Only this design's logs (omit to scan every log)",
    },
    {
      name: "log_id",
      type: "string",
      required: false,
      description: "Only this consumption log",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max logs to scan in one call (default 1000, max ${MAX_APPLIED_BACKFILL_SCAN})`,
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
    const { design_id, log_id, limit } = parsed.data

    const consumptionService: any = container.resolve(CONSUMPTION_LOG_MODULE)

    const filters: Record<string, any> = {}
    if (design_id) filters.design_id = design_id
    if (log_id) filters.id = log_id

    const logs: any[] = await consumptionService.listConsumptionLogs(filters, {
      take: limit,
      order: { id: "ASC" },
    })

    if (!logs.length) {
      return {
        job_id: "backfill-consumption-applied-columns",
        dry_run,
        applied: false,
        summary: "No consumption logs matched the filters.",
        changes: [],
      }
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    const tally: Record<AppliedBackfillVerdict, number> = {
      already_migrated: 0,
      fill: 0,
      never_applied: 0,
      conflict: 0,
    }
    let filled = 0

    for (const log of logs) {
      const metaAt = (log.metadata || {})[APPLIED_AT_KEY] ?? null
      const metaLocation = (log.metadata || {})[APPLIED_LOCATION_KEY] ?? null

      const { verdict } = classifyAppliedBackfill({
        column_at: log.inventory_applied_at,
        metadata_at: metaAt,
      })
      tally[verdict] += 1

      if (verdict === "conflict") {
        changes.push({
          entity: "consumption_log",
          id: log.id,
          field: "inventory_applied_at (CONFLICT — not touched)",
          before: String(log.inventory_applied_at),
          after: String(metaAt),
        })
        continue
      }

      if (verdict !== "fill") continue

      changes.push({
        entity: "consumption_log",
        id: log.id,
        field: "inventory_applied_at",
        before: null,
        after: String(metaAt),
      })

      if (!dry_run) {
        try {
          await consumptionService.updateConsumptionLogs({
            id: log.id,
            inventory_applied_at: metaAt,
            // Only fill the location when the column is empty; a location the
            // apply job already recorded is the one the stock actually came
            // off, and metadata must not overwrite it.
            ...(log.inventory_applied_location_id == null && metaLocation
              ? { inventory_applied_location_id: metaLocation }
              : {}),
          })
          filled += 1
        } catch (e: any) {
          errors.push({ id: log.id, message: e?.message ?? String(e) })
        }
      }
    }

    const summary =
      `Scanned ${logs.length} consumption log(s): ${tally.fill} to fill, ` +
      `${tally.already_migrated} already migrated, ${tally.never_applied} never applied, ` +
      `${tally.conflict} conflicting (reported, untouched). ` +
      (dry_run
        ? "Dry run — nothing written."
        : `Filled ${filled}. Legacy metadata keys left in place.`)

    return {
      job_id: "backfill-consumption-applied-columns",
      dry_run,
      applied: !dry_run && filled > 0,
      summary,
      changes,
      errors,
    }
  },
}
