import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { DESIGN_MODULE } from "../../../../modules/designs"
import { recomputeDesignCost } from "./registry"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — put back the "unknown" that a recalculation overwrote (#1564).
 *
 * `estimateDesignCostWorkflow` reported "no bill of materials, no order
 * history, nothing to go on" as `total_estimated: 0`, and the recalculate paths
 * persisted it. Designs whose cost was honestly NULL came out the other side
 * stating that they cost nothing — and `0` is not a small number here, it is a
 * claim that the work is free. Every downstream reader believed it: the payment
 * guard (until #1563 required a positive number), the cost panels, and the
 * storefront checkout, which turned it straight into a customer-facing price.
 *
 * Running the recalculation was itself the damaging act. This undoes it.
 *
 * ⚠️ Restores a field to the value it held BEFORE an automated write. It
 * creates nothing, prices nothing, and touches no payment or order.
 *
 * ## It re-asks the question before clearing anything
 *
 * 🔴 A stored 0 is not sufficient grounds to null a design. The job re-runs the
 * estimator on each candidate and clears it ONLY if the estimator still cannot
 * price it. If the design has since gained a BOM or cost history, the estimator
 * now returns a real figure — and the right repair is a recalculation, not a
 * deletion. Those are reported as `repriceable` and left untouched, because
 * silently writing the new figure would be this job making a pricing decision
 * it has no mandate for.
 *
 * Only clears a design whose stored cost is exactly 0. A design with a real
 * cost is never a candidate, so a mis-scoped run cannot erase a price someone
 * set deliberately.
 *
 * Safe to re-run: once cleared, the fields are null and no longer 0.
 */
const paramsSchema = z.object({
  /** One design, for a spot check before a full pass. */
  design_id: z.string().min(1).optional(),
  /** Bound a first pass; omitted means every design that needs one. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

/**
 * PURE: is this design's stored cost the residue of an empty estimate?
 * Exported for tests.
 *
 * Requires `estimated_cost` to be exactly 0 — not null (already correct), not
 * negative, not positive. `Number(...)` because the column comes back as a
 * bigNumber-ish value, and `"0"` must count.
 */
export function hasZeroStoredCost(design: {
  estimated_cost?: unknown
}): boolean {
  const raw = design?.estimated_cost
  if (raw === null || raw === undefined) {
    return false
  }
  const value = Number(raw)
  return Number.isFinite(value) && value === 0
}

export const clearUnpriceableDesignCostsJob: MaintenanceJob = {
  id: "clear-unpriceable-design-costs",
  label: "Clear design costs that a recalculation zeroed",
  description:
    "Restore estimated_cost / material_cost / production_cost to NULL on designs where an earlier recalculation stored 0 because it had nothing to estimate from (#1564). A stored 0 says 'this work is free' and every reader believes it — the payment guard, the cost panels, and the storefront checkout, which turned it into a customer-facing price of zero. Running the recalculation was the damaging act; this undoes it. RE-ASKS THE QUESTION FIRST: each candidate is re-estimated, and cleared only if the estimator still cannot price it — a design that has since gained a bill of materials or cost history is reported as 'repriceable' and left alone, because the right repair there is a recalculation, not a deletion. Only ever touches a design whose stored cost is exactly 0, so a price someone set deliberately can never be erased. Creates nothing, prices nothing, touches no payment or order. Safe to re-run.",
  params: [
    {
      name: "design_id",
      type: "string",
      required: false,
      description: "Only this design, e.g. for a spot check before a full pass.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Stop after this many designs. Omit for every design that needs one.",
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

    const designService: any = container.resolve(DESIGN_MODULE)

    const designs = (await designService.listDesigns(
      parsed.data.design_id ? { id: parsed.data.design_id } : {},
      { take: null }
    )) as any[]

    if (parsed.data.design_id && !(designs || []).length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design ${parsed.data.design_id} not found`
      )
    }

    const candidates = (designs || []).filter(hasZeroStoredCost)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    /** Now priceable — the estimator found data since. Left for a recalculation. */
    const repriceable: Array<{ id: string; name: string; total: number }> = []

    for (const design of candidates) {
      if (parsed.data.limit && changes.length >= parsed.data.limit) {
        break
      }

      try {
        const { result } = await recomputeDesignCost(container, design.id)

        if (result.total_estimated != null) {
          // The estimator can price it now. Clearing would throw away a real
          // answer; writing it would be this job deciding a price. Report it.
          repriceable.push({
            id: design.id,
            name: design.name ?? "(unnamed)",
            total: result.total_estimated,
          })
          continue
        }

        changes.push({
          entity: "design",
          id: design.id,
          field: "estimated_cost",
          before: 0,
          after: null,
        })

        if (!dry_run) {
          await designService.updateDesigns({
            id: design.id,
            estimated_cost: null,
            material_cost: null,
            production_cost: null,
          })
        }
      } catch (e: any) {
        // One unreadable design must not strand the rest of the pass.
        errors.push({ id: design?.id ?? "(unknown)", message: e?.message ?? String(e) })
      }
    }

    const parts: string[] = []
    parts.push(
      changes.length
        ? `${dry_run ? "Would clear" : "Cleared"} the zeroed cost on ${
            changes.length
          } design(s): ${changes.map((c) => c.id).join(", ")}`
        : "No design carries a cost of 0 that the estimator still cannot price"
    )
    if (repriceable.length) {
      parts.push(
        `${repriceable.length} design(s) can now be priced and were LEFT UNCHANGED — recalculate them instead: ${repriceable
          .map((r) => `${r.id} (${r.name} → ${r.total})`)
          .join("; ")}`
      )
    }

    return {
      job_id: "clear-unpriceable-design-costs",
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: parts.join(". ") + ".",
      changes,
      errors,
    }
  },
}
