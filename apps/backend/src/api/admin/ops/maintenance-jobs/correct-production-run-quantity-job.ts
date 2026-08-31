import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Correct a production run's AGREED QUANTITY — and its produced quantity.
 *
 * ## Why this is an ops job and not a route
 *
 * `POST /admin/production-runs/:id` refuses any quantity change once the run
 * has been accepted or started, and refuses outright when it is completed. That
 * guard is #1676: a run's quantity is the ceiling on what may ever be billed
 * against it, so raising it after the work is recorded retroactively increases
 * what a partner may claim. It is the right default and it should stay.
 *
 * But the real world does correct itself. A run sent for 2 where the partner
 * made 3 leaves the record wrong in a way nothing else can fix: the payment
 * correction route runs `assessRunClaims` and refuses a claim of 3 against a
 * ceiling of 2, so the run and the money deadlock against each other.
 *
 * So the capability exists here, where it is dry-run by default, audited with
 * before/after, and impossible to reach by accident from the admin UI.
 *
 * ## 🔴 What it refuses
 *
 * **Lowering the quantity below what has already been claimed.** Existing
 * claims are measured against this ceiling; drop it under them and previously
 * valid submissions become retroactive overclaims, with no mechanism to notice.
 * Raising is additive and safe; lowering is not, and the difference is not
 * symmetric.
 *
 * A cancelled run is refused outright, matching the cost job.
 *
 * ## What it reports
 *
 * Every run always reports the CEILING CONSEQUENCE: what was claimable before,
 * what becomes claimable after, and what that is worth at the run's own rate.
 * A quantity correction that does not say "this makes ₹700 more billable" is a
 * number changing in silence next to money.
 */

const paramsSchema = z
  .object({
    production_run_id: z.string().min(1, "production_run_id is required"),
    /**
     * The agreed quantity. `null` makes the run OPEN-ENDED — no ceiling at all
     * (#1676's per-run opt-out) — which is a much larger statement than a
     * number, so it must be typed explicitly rather than arrived at by omission.
     */
    quantity: z.union([z.number().positive(), z.null()]).optional(),
    /**
     * What the partner actually made. Distinct from `quantity`, which is what
     * was ordered — the payout basis reads produced, the ceiling reads agreed,
     * and a correction usually needs both moved together.
     */
    produced_quantity: z.union([z.number().nonnegative(), z.null()]).optional(),
  })
  .refine((v) => v.quantity !== undefined || v.produced_quantity !== undefined, {
    message: "provide at least one of quantity or produced_quantity to correct",
  })

/** PURE: what a run's claims already total, so a lowering can be refused. */
export const claimedQuantityForRun = (
  items: Array<{ production_run_ids?: string[] | null; quantity?: number | null }>,
  runId: string
): number =>
  (items ?? [])
    .filter((i) => (i?.production_run_ids ?? []).includes(runId))
    .reduce((sum, i) => sum + Number(i?.quantity ?? 0), 0)

export const correctProductionRunQuantityJob: MaintenanceJob = {
  id: "correct-production-run-quantity",
  label: "Correct a production run's quantity",
  description:
    "Set a production run's agreed quantity and/or produced quantity, past the guard that freezes them once a run is accepted or completed. The agreed quantity is the CEILING on what may be billed against the run (#1676), so the dry-run reports what becomes newly claimable and what that is worth at the run's own rate. Refuses to lower the quantity below what existing submissions have already claimed — that would turn valid claims into retroactive overclaims. A cancelled run cannot be edited. quantity:null makes the run open-ended (no ceiling).",
  params: [
    {
      name: "production_run_id",
      type: "string",
      required: true,
      description: "ID of the production run to correct",
    },
    {
      name: "quantity",
      type: "number",
      required: false,
      description:
        "New agreed quantity — the billing ceiling. null makes the run open-ended (no ceiling).",
    },
    {
      name: "produced_quantity",
      type: "number",
      required: false,
      description: "What the partner actually made. The payout basis reads this.",
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
    const { production_run_id, quantity, produced_quantity } = parsed.data

    const service: any = container.resolve(PRODUCTION_RUNS_MODULE)

    let run: any = null
    try {
      run = await service.retrieveProductionRun(production_run_id)
    } catch {
      run = null
    }
    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run not found: ${production_run_id}`
      )
    }
    if (run.status === "cancelled") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot edit a cancelled production run"
      )
    }

    /**
     * What has already been claimed against this run.
     *
     * ⚠️ Read from the submission ITEMS, not from the run — the run holds no
     * record of what has been billed against it. This is the number a lowering
     * must not go under.
     */
    let claimed = 0
    try {
      const submissions: any = container.resolve(PAYMENT_SUBMISSIONS_MODULE)
      const items = await submissions.listPaymentSubmissionItems({}, { take: 5000 })
      claimed = claimedQuantityForRun(items ?? [], production_run_id)
    } catch {
      // If claims cannot be read, a LOWERING cannot be proven safe — refuse it
      // below rather than assume zero.
      claimed = Number.NaN
    }

    const beforeQuantity = run.quantity ?? null
    const beforeProduced = run.produced_quantity ?? null

    if (quantity !== undefined && quantity !== null) {
      if (Number.isNaN(claimed)) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Could not read existing claims for this run — refusing to change a billing ceiling blind."
        )
      }
      if (quantity < claimed) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `Refusing to lower the agreed quantity to ${quantity}: ${claimed} has already been claimed against this run, which would become a retroactive overclaim.`
        )
      }
    }

    const changes: MaintenanceChange[] = []
    if (quantity !== undefined && quantity !== beforeQuantity) {
      changes.push({
        entity: "production_run",
        id: production_run_id,
        field: "quantity",
        before: beforeQuantity,
        after: quantity,
      })
    }
    if (produced_quantity !== undefined && produced_quantity !== beforeProduced) {
      changes.push({
        entity: "production_run",
        id: production_run_id,
        field: "produced_quantity",
        before: beforeProduced,
        after: produced_quantity,
      })
    }

    if (!dry_run && changes.length > 0) {
      const update: Record<string, unknown> = { id: production_run_id }
      if (quantity !== undefined) update.quantity = quantity
      if (produced_quantity !== undefined) update.produced_quantity = produced_quantity
      await service.updateProductionRuns(update)
    }

    /**
     * The ceiling consequence, always stated. A quantity moving next to money
     * in silence is how a correction becomes a surprise on someone's payout.
     */
    const effQuantity = quantity !== undefined ? quantity : beforeQuantity
    const rate = Number(run.partner_cost_estimate ?? 0)
    const perUnit = run.cost_type === "per_unit" && rate > 0 ? rate : null

    const ceilingNote =
      effQuantity === null
        ? "run becomes OPEN-ENDED — no ceiling on what may be billed against it"
        : Number.isNaN(claimed)
          ? `ceiling ${effQuantity}; existing claims unknown`
          : `ceiling ${beforeQuantity ?? "none"} → ${effQuantity}; already claimed ${claimed}; newly claimable ${Math.max(0, effQuantity - claimed)}${
              perUnit ? ` (worth ${Math.max(0, effQuantity - claimed) * perUnit} at ${perUnit}/unit)` : ""
            }`

    const summary =
      changes.length === 0
        ? `No changes — production run ${production_run_id} already as requested; ${ceilingNote}`
        : `${dry_run ? "Would update" : "Updated"} ${changes.length} field(s) on production run ${production_run_id}; ${ceilingNote}`

    return {
      job_id: correctProductionRunQuantityJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
    }
  },
}

export default correctProductionRunQuantityJob
