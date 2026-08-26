import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — record WHICH run a payout covered, when only a human knows (#1565).
 *
 * `payment_submission_item.production_run_ids` is what stops the same finished
 * run being paid for twice. `backfill-payment-line-run-provenance` recovers it
 * wherever a submission already states it in `metadata`, but some lines say it
 * only in their free-text `notes` — and that job refuses to parse prose, because
 * a parser that is right about today's sentence is wrong about the one someone
 * writes next month.
 *
 * 🔴 There is no other way to fix such a line. `/admin/payment-submissions/:id`
 * exposes GET and `review` and nothing else: no route updates a submission or
 * its items. Without this job the only remedy is rejecting a live payout and
 * recreating it, which churns a real claim and changes its id.
 *
 * ⚠️ Records something that ALREADY happened. It changes no amount, approves
 * nothing, and moves no money.
 *
 * ## The operator supplies the fact; the job still checks it
 *
 * An operator-asserted run id is NOT taken on trust. It must satisfy every rule
 * the create path enforces — the run exists, is completed, belongs to the
 * submission's partner, is a run of that line's design, and is not already
 * recorded on another live payout. A wrong id here is worse than an empty
 * column: empty reads `unknown` and stops a human, wrong reads `billed` and
 * silently blocks a partner's real payout, or releases a run that was paid.
 *
 * Refuses to overwrite a line that already records runs — correcting one of
 * those is a different decision, and a silent overwrite would erase provenance
 * written by a real submission path.
 */
const paramsSchema = z.object({
  /** The line to record against. */
  payment_submission_item_id: z.string().min(1, "payment_submission_item_id is required"),
  /** The completed run that line paid for. */
  production_run_id: z.string().min(1, "production_run_id is required"),
})

export const recordPaymentLineRunJob: MaintenanceJob = {
  id: "record-payment-line-run",
  label: "Record which production run a payment line paid for",
  description:
    "Set production_run_ids on ONE payment submission line to a run id an operator supplies, for lines whose provenance exists only in free-text notes and so cannot be recovered automatically (#1565). This is the only way to correct such a line: /admin/payment-submissions/:id exposes GET and review and nothing else, so no route updates a submission or its items, and the alternative is rejecting a live payout and recreating it. The supplied id is NOT trusted — it must pass every check the create path enforces: the run exists, is completed, belongs to the submission's partner, is a run of that line's design, and is not already recorded on another non-Rejected payout. Refuses to overwrite a line that already records runs. Records something that already happened: changes no amount, approves nothing, moves no money. Dry-run previews the exact before/after.",
  params: [
    {
      name: "payment_submission_item_id",
      type: "string",
      required: true,
      description: "The payment submission LINE id (not the submission id).",
    },
    {
      name: "production_run_id",
      type: "string",
      required: true,
      description: "The completed production run that line paid for.",
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
    const { payment_submission_item_id: itemId, production_run_id: runId } = parsed.data

    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const items = (await (service as any).listPaymentSubmissionItems(
      { id: itemId },
      { relations: ["submission"] }
    )) as any[]
    const item = (items || [])[0]

    if (!item) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Payment submission item ${itemId} not found`
      )
    }

    const existing = (item.production_run_ids ?? []) as string[]
    if (Array.isArray(existing) && existing.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Payment line ${itemId} already records run(s) ${existing.join(", ")}. Overwriting recorded provenance is a different decision — reject and recreate the submission instead.`
      )
    }

    // A task payout never had a run. Recording one would invent a relationship
    // that does not exist, and `no_run` is already the correct answer for it.
    if (!item.design_id || item.source_type === "task") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Payment line ${itemId} is not sourced from a design (source_type=${item.source_type}); a task payout has no production run.`
      )
    }

    const { data: runs } = await query.graph({
      entity: "production_runs",
      fields: ["id", "design_id", "partner_id", "status"],
      filters: { id: [runId] },
    })
    const run = ((runs || []) as any[])[0]

    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run ${runId} not found`
      )
    }

    // A run belongs to exactly one design. If it is not a run of this line's
    // design, the operator has named something else entirely.
    if (String(run.design_id || "") !== String(item.design_id)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Production run ${runId} is a run of design ${run.design_id}, not ${item.design_id}`
      )
    }

    const submissionPartnerId = String(item.submission?.partner_id || "")
    if (submissionPartnerId && String(run.partner_id || "") !== submissionPartnerId) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Production run ${runId} belongs to partner ${run.partner_id}, but the submission is partner ${submissionPartnerId}`
      )
    }

    if (String(run.status || "") !== "completed") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Production run ${runId} is not completed (${run.status})`
      )
    }

    /**
     * Already claimed by someone else? A Rejected submission never paid anyone,
     * so its lines release their runs; every other status is a live claim.
     *
     * 🔴 The same rule the create path applies. Without it this job would be a
     * hole straight through the double-pay guard it exists to arm.
     */
    const siblings = (await (service as any).listPaymentSubmissionItems(
      { design_id: [String(item.design_id)] },
      { relations: ["submission"] }
    )) as any[]

    for (const other of siblings || []) {
      if (String(other.id) === String(itemId)) continue
      if (String(other.submission?.status || "") === "Rejected") continue
      for (const claimed of (other.production_run_ids || []) as string[]) {
        if (String(claimed) === runId) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Production run ${runId} is already recorded on payment line ${other.id} (submission ${other.submission?.id || other.submission_id}, status ${other.submission?.status}). Recording it here would claim the same finished work twice.`
          )
        }
      }
    }

    const changes: MaintenanceChange[] = [
      {
        entity: "payment_submission_item",
        id: itemId,
        field: "production_run_ids",
        before: null,
        after: [runId],
      },
    ]

    if (!dry_run) {
      await (service as any).updatePaymentSubmissionItems({
        id: itemId,
        production_run_ids: [runId],
        run_provenance: "recorded",
      })
    }

    return {
      job_id: "record-payment-line-run",
      dry_run,
      applied: !dry_run,
      summary: `${
        dry_run ? "Would record" : "Recorded"
      } run ${runId} on payment line ${itemId} (design ${item.design_id}, submission ${
        item.submission?.id || item.submission_id
      }, status ${item.submission?.status}). Amount unchanged at ${item.amount}.`,
      changes,
    }
  },
}
