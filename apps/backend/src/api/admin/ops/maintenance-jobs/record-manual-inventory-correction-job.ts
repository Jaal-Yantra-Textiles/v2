import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — record a stock correction that was made BY HAND.
 *
 * The live case (#1259): `FAB-TWO-BLU-001` sat at -2.5 at Shramdaan India
 * Warehouse and was corrected to 0 through the admin, not through a job. Every
 * job-driven write leaves an `ops_maintenance_run` row; that one left nothing.
 * So the single most consequential inventory write of the whole #1248 thread is
 * the one with no audit trail, and a later reader has no way to learn the value
 * moved, let alone why.
 *
 * This does NOT change stock. It writes the record that should have existed:
 * an `ops_maintenance_run` row (created by the run route around every job) plus
 * an entry appended to the inventory item's `metadata.manual_corrections`, so
 * the history is visible where the stock is, not only in the ops log.
 *
 * ⚠️ It is a STATEMENT BY THE OPERATOR, not a derived fact — which is why
 * `reason` is required and why the job reads the level and reports what it
 * currently holds. If the current value contradicts the `after` being claimed,
 * the summary says so rather than recording the claim unchallenged. A
 * retroactive record that cannot be checked is worth very little; one that
 * shows its disagreement is worth a lot.
 *
 * ⚠️ Metadata is annotation here, never the source of truth (the stock level
 * is). Nothing reads these entries to make a decision.
 */

const paramsSchema = z.object({
  inventory_item_id: z.string().min(1),
  location_id: z.string().min(1),
  /** The value before the manual correction, e.g. -2.5. */
  before: z.number(),
  /** The value it was corrected to, e.g. 0. */
  after: z.number(),
  /** Why. Required — an audit entry without a reason just moves the mystery. */
  reason: z.string().min(3),
  /** When it was actually done, ISO. Defaults to now, and says which it used. */
  corrected_at: z.string().min(4).optional(),
  /** Who did it, if known. Free text — this is a human record. */
  corrected_by: z.string().min(1).optional(),
})

/** Read the value out of a `raw_<field>` jsonb, whatever shape it arrives in. */
const rawValue = (raw: unknown): number | null => {
  if (raw == null) {
    return null
  }
  const v =
    typeof raw === "object" && raw !== null && "value" in (raw as any)
      ? (raw as any).value
      : raw
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const recordManualInventoryCorrectionJob: MaintenanceJob = {
  id: "record-manual-inventory-correction",
  label: "Record a stock correction that was made by hand",
  description:
    "Write the audit trail for an inventory correction performed through the admin rather than by a job — the -2.5 → 0 fix on FAB-TWO-BLU-001 being the case this exists for (#1259). Creates the ops_maintenance_run row every job-driven write already leaves, and appends the same record to the inventory item's metadata.manual_corrections so the history sits alongside the stock. It does NOT change any stock level. Reads the level first and reports it: when the live value disagrees with the correction being recorded, the summary says so instead of accepting the claim. reason is required.",
  params: [
    {
      name: "inventory_item_id",
      type: "string",
      required: true,
      description: "The inventory item that was corrected",
    },
    {
      name: "location_id",
      type: "string",
      required: true,
      description: "The stock location whose level was corrected",
    },
    {
      name: "before",
      type: "number",
      required: true,
      description: "The value before the manual correction, e.g. -2.5",
    },
    {
      name: "after",
      type: "number",
      required: true,
      description: "The value it was corrected to, e.g. 0",
    },
    {
      name: "reason",
      type: "string",
      required: true,
      description: "Why the correction was made. Required.",
    },
    {
      name: "corrected_at",
      type: "string",
      required: false,
      description: "When it was done (ISO). Defaults to now.",
    },
    {
      name: "corrected_by",
      type: "string",
      required: false,
      description: "Who did it, if known.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")
      )
    }

    const {
      inventory_item_id,
      location_id,
      before,
      after,
      reason,
      corrected_at,
      corrected_by,
    } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const inventoryService: any = container.resolve(Modules.INVENTORY)

    // What the level holds NOW. Both halves of the bigNumber pair, because
    // they have been seen to disagree on exactly this row (#1259) and reading
    // one side is how the divergence went unnoticed the first time.
    const { data: levels } = await query.graph({
      entity: "inventory_level",
      fields: [
        "id",
        "inventory_item_id",
        "location_id",
        "stocked_quantity",
        "raw_stocked_quantity",
      ],
      filters: { inventory_item_id, location_id },
    })

    const level = (levels || [])[0]
    if (!level) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No inventory level for ${inventory_item_id} at ${location_id}. Nothing was recorded — a correction cannot be attested against a level that does not exist.`
      )
    }

    const numeric = Number(level.stocked_quantity ?? NaN)
    const raw = rawValue(level.raw_stocked_quantity)
    // The record is checked against BOTH sides. Agreeing with either is enough
    // to say the correction is consistent with what is stored.
    const observed = [numeric, raw].filter(
      (n): n is number => n != null && Number.isFinite(n)
    )
    const consistent = observed.some((v) => v === after)

    const at = corrected_at ?? new Date().toISOString()

    const entry = {
      kind: "manual_stock_correction",
      location_id,
      level_id: level.id,
      before,
      after,
      reason,
      corrected_at: at,
      corrected_by: corrected_by ?? null,
      /**
       * Whether the live level agreed at the time of recording. Stored, not
       * just reported: a reader a year from now needs to know this entry was
       * checked, and against what.
       */
      observed_at_record_time: {
        numeric: Number.isFinite(numeric) ? numeric : null,
        raw,
        consistent,
      },
      recorded_by_job: "record-manual-inventory-correction",
    }

    const changes: MaintenanceChange[] = [
      {
        entity: "inventory_level",
        id: `${inventory_item_id}@${location_id}`,
        field: "stocked_quantity (recorded, not written)",
        before,
        after,
      },
    ]

    if (!dry_run) {
      const item = await inventoryService.retrieveInventoryItem(
        inventory_item_id
      )
      const existing = (item?.metadata ?? {}) as Record<string, any>
      const priorCorrections = Array.isArray(existing.manual_corrections)
        ? existing.manual_corrections
        : []

      // APPEND. A metadata update merges at the top level only, so writing
      // `manual_corrections` without carrying the previous entries forward
      // would erase every earlier record — the exact loss this job is fixing.
      await inventoryService.updateInventoryItems([
        {
          id: inventory_item_id,
          metadata: {
            ...existing,
            manual_corrections: [...priorCorrections, entry],
          },
        },
      ])
    }

    const summary = [
      `${dry_run ? "Would record" : "Recorded"} a manual correction of ${inventory_item_id}@${location_id}: ${before} → ${after} (${reason})${
        corrected_by ? ` by ${corrected_by}` : ""
      }, at ${at}${corrected_at ? "" : " (defaulted to now — the actual correction was earlier)"}`,
      // The check is stated in both directions. "Recorded" alone would read as
      // "verified", and this job cannot verify a past write — only compare.
      consistent
        ? `The live level agrees: it currently holds ${after}.`
        : `⚠️ The live level does NOT match what is being recorded — it currently reads numeric=${
            Number.isFinite(numeric) ? numeric : "unreadable"
          }, raw=${raw ?? "unreadable"}, and the record claims it was set to ${after}. The record is kept as the operator's statement; the disagreement is real and worth chasing before trusting either.`,
      "No stock was changed by this job.",
    ]
      .filter(Boolean)
      .join(" ")

    return {
      job_id: recordManualInventoryCorrectionJob.id,
      dry_run,
      // `applied` = the RECORD was written, never the stock.
      applied: !dry_run,
      summary,
      changes,
    }
  },
}
