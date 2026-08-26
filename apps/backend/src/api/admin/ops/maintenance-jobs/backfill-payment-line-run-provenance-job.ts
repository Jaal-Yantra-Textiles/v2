import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — move each payout's run id into the column that guards it (#1565).
 *
 * `payment_submission_item.production_run_ids` decides whether the same finished
 * run can be billed twice. On production it was NULL on every one of the 13
 * submissions, so the guard was inert while the payable-runs screen presented
 * its silence as "nothing billed yet".
 *
 * Nine of those rows are not actually missing their run — they recorded it, just
 * not where the guard looks. Two writers spelled one fact two ways:
 *
 *   - `metadata.production_run_id`         — the auto-draft subscriber
 *   - `metadata.source_production_run_id`  — the admin submission screen
 *
 * That is #1557 exactly: a `metadata` key is validated as
 * `z.record(z.string(), z.any())`, so either spelling stores cleanly and neither
 * guards anything. This job copies the answer onto the real column.
 *
 * ⚠️ It records something that ALREADY HAPPENED. It creates no submission,
 * approves nothing, moves no money, and changes no amount.
 *
 * ## It transcribes; it does not deduce
 *
 * 🔴 A recovered id is still CHECKED before it is trusted: the run must exist,
 * belong to the submission's partner, and be a run of the line's own design. A
 * wrong run id in this column is worse than an empty one — an empty column
 * reports `unknown` and stops a human, while a wrong one reports `billed` and
 * silently blocks a partner's real payout (or clears a run that was already
 * paid). Anything that fails a check is skipped and reported, never written.
 *
 * 🔴 It never reads the run id out of `notes`. Prose is not a contract, and one
 * production row states its run in the notes alone — that row is deliberately
 * left for a human, because a parser that is right about it today is a parser
 * that will be wrong about the sentence someone writes next month.
 *
 * A line with no recoverable run stays `not_recorded` — "not added to bills".
 * That is the honest outcome, not a failure of this job: the information was
 * never created, and inventing it here would be inventing payout provenance.
 *
 * Never overwrites a line that already records runs. Safe to re-run.
 */
const paramsSchema = z.object({
  /** One submission, for a spot check before a full pass. */
  payment_submission_id: z.string().min(1).optional(),
  /** Bound a first pass; omitted means every line that needs one. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

type SubmissionMetadata = {
  production_run_id?: unknown
  source_production_run_id?: unknown
}

/**
 * PURE: the run id a submission already states, and under which spelling.
 * Exported for tests.
 *
 * Both keys are read because both exist in production and mean the same thing.
 * `production_run_id` wins only because it is the older writer; when a row
 * somehow carries both AND they disagree, that is a contradiction rather than a
 * fact, and the caller must skip it — hence `conflict`.
 */
export function recoverRunIdFromMetadata(
  metadata: SubmissionMetadata | null | undefined
): { runId: string | null; key: string | null; conflict: boolean } {
  const md = (metadata ?? {}) as SubmissionMetadata

  const fromSubscriber =
    typeof md.production_run_id === "string" && md.production_run_id.length
      ? md.production_run_id
      : null
  const fromAdmin =
    typeof md.source_production_run_id === "string" &&
    md.source_production_run_id.length
      ? md.source_production_run_id
      : null

  if (fromSubscriber && fromAdmin && fromSubscriber !== fromAdmin) {
    return { runId: null, key: null, conflict: true }
  }

  if (fromSubscriber) {
    return { runId: fromSubscriber, key: "production_run_id", conflict: false }
  }
  if (fromAdmin) {
    return {
      runId: fromAdmin,
      key: "source_production_run_id",
      conflict: false,
    }
  }
  return { runId: null, key: null, conflict: false }
}

export const backfillPaymentLineRunProvenanceJob: MaintenanceJob = {
  id: "backfill-payment-line-run-provenance",
  label: "Record which production run each existing payout paid for",
  description:
    "Copy the production run id that a payment submission ALREADY states in its metadata onto payment_submission_item.production_run_ids, the column the double-pay guard actually reads (#1565). Two writers spelled the same fact two different ways (metadata.production_run_id from the auto-draft subscriber, metadata.source_production_run_id from the admin screen) and the guard reads neither, so on production every payment line looked like 'no run billed' and the payable-runs screen ranked already-paid work as clean. Records something that already happened: creates no submission, approves nothing, changes no amount, moves no money. Each recovered id is VERIFIED before it is written — the run must exist, belong to the submission's partner, and be a run of that line's design — and anything failing a check is skipped and reported rather than written, because a wrong run id blocks a partner's real payout. Never reads the run id out of free-text notes. A line with no recoverable run is left as 'not_recorded' ('not added to bills'), which is the honest state, not a failure. Never overwrites a line that already records runs. Safe to re-run.",
  params: [
    {
      name: "payment_submission_id",
      type: "string",
      required: false,
      description: "Only this submission, e.g. for a spot check before a full pass.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Stop after this many lines. Omit for every line that needs one.",
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

    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const items = (await (service as any).listPaymentSubmissionItems(
      parsed.data.payment_submission_id
        ? { submission_id: parsed.data.payment_submission_id }
        : {},
      { relations: ["submission"], take: null }
    )) as any[]

    if (parsed.data.payment_submission_id && !(items || []).length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Payment submission ${parsed.data.payment_submission_id} has no line items`
      )
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    /** Lines whose run is genuinely unrecoverable — the honest `not_recorded`. */
    const noProvenance: string[] = []
    /** Recovered an id, but it failed a check. Reported, never written. */
    const rejected: Array<{ id: string; reason: string }> = []
    let alreadyRecorded = 0
    let notRunSourced = 0

    for (const item of items || []) {
      if (parsed.data.limit && changes.length >= parsed.data.limit) {
        break
      }

      try {
        const existing = (item?.production_run_ids ?? []) as string[]
        if (Array.isArray(existing) && existing.length) {
          // Written by a real submission path. Better evidence than anything
          // recovered here.
          alreadyRecorded++
          continue
        }

        // A task payout never had a run. The migration already classified
        // these; nothing to recover and nothing to report as a gap.
        if (!item?.design_id || item?.source_type === "task") {
          notRunSourced++
          continue
        }

        const { runId, key, conflict } = recoverRunIdFromMetadata(
          item?.submission?.metadata
        )

        if (conflict) {
          rejected.push({
            id: item.id,
            reason:
              "submission metadata names two different production runs; a contradiction is not a fact",
          })
          continue
        }

        if (!runId) {
          // The information was never created. Leaving it `not_recorded` is the
          // point — see the job doc.
          noProvenance.push(item.id)
          continue
        }

        const { data: runs } = await query.graph({
          entity: "production_runs",
          fields: ["id", "design_id", "partner_id", "status"],
          filters: { id: [runId] },
        })
        const run = ((runs || []) as any[])[0]

        if (!run) {
          rejected.push({
            id: item.id,
            reason: `metadata.${key} names run ${runId}, which does not exist`,
          })
          continue
        }

        // A run belongs to exactly one design. If the stated run is not a run
        // of this line's design, the metadata is describing something else and
        // must not become this line's provenance.
        if (String(run.design_id || "") !== String(item.design_id)) {
          rejected.push({
            id: item.id,
            reason: `run ${runId} is a run of design ${run.design_id}, not ${item.design_id}`,
          })
          continue
        }

        const submissionPartnerId = String(item?.submission?.partner_id || "")
        if (
          submissionPartnerId &&
          String(run.partner_id || "") !== submissionPartnerId
        ) {
          rejected.push({
            id: item.id,
            reason: `run ${runId} belongs to partner ${run.partner_id}, but the submission is partner ${submissionPartnerId}`,
          })
          continue
        }

        changes.push({
          entity: "payment_submission_item",
          id: item.id,
          field: "production_run_ids",
          before: null,
          after: [runId],
        })

        if (!dry_run) {
          await (service as any).updatePaymentSubmissionItems({
            id: item.id,
            production_run_ids: [runId],
            run_provenance: "recorded",
          })
        }
      } catch (e: any) {
        // One unreadable line must not strand the rest of the pass.
        errors.push({ id: item?.id ?? "(unknown)", message: e?.message ?? String(e) })
      }
    }

    const parts: string[] = []
    parts.push(
      changes.length
        ? `${dry_run ? "Would record" : "Recorded"} the production run for ${
            changes.length
          } payment line(s): ${changes
            .map((c) => `${c.id} → ${(c.after as string[]).join(", ")}`)
            .join("; ")}`
        : "No payment line has a recoverable production run"
    )
    if (noProvenance.length) {
      parts.push(
        `${noProvenance.length} line(s) have no run recorded anywhere and stay "not_recorded" — not added to bills: ${noProvenance.join(", ")}`
      )
    }
    if (rejected.length) {
      parts.push(
        `${rejected.length} line(s) SKIPPED — a recovered id failed verification: ${rejected
          .map((r) => `${r.id} (${r.reason})`)
          .join("; ")}`
      )
    }
    if (alreadyRecorded) {
      parts.push(`${alreadyRecorded} line(s) already record their run`)
    }
    if (notRunSourced) {
      parts.push(`${notRunSourced} line(s) are not run-sourced (task payouts)`)
    }

    return {
      job_id: "backfill-payment-line-run-provenance",
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: parts.join(". ") + ".",
      changes,
      errors,
    }
  },
}
