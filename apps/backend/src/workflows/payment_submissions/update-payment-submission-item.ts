import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../modules/payment_submissions"
import PaymentSubmissionsService from "../../modules/payment_submissions/service"
import {
  designsBilledWithoutRunEvidence,
  runlessResubmitMessage,
} from "./lib/run-evidence-guard"
import {
  assessRunClaims,
  listPartnerRunTallies,
  listRunOrderedQuantities,
  requestedRunQuantities,
  runsOverclaimedMessage,
} from "./lib/run-claims"
import { resolveDesignLineAmount } from "./create-payment-submission"

/**
 * Correct one line on a payment submission (#1604).
 *
 * ## The gap this closes
 *
 * Until now a submission had exactly two exits — approve or reject, wholesale.
 * Nothing could change a line. That is not hypothetical:
 * `audit-partner-payout-quantity` refuses to write by design ("the correction
 * is a payment decision rather than a data repair") and tells an operator to
 * correct the line; there was no route to correct the line. On production two
 * lines sit in exactly that state, reported as `unmatched` and untouchable.
 *
 * ## 🔴 The guards are the point, not the edit
 *
 * `production_run_ids` is the column that decides whether the same work can be
 * billed twice. An edit route that writes it without re-running the claim
 * checks is an open window beside a locked door:
 *
 *     submit naming no runs        → refused by the guard
 *     submit clean, then PATCH runs in → completely unguarded
 *
 * So every check `create-payment-submission` runs over claimed runs runs here
 * too, with this submission excluded from the priors.
 *
 * ## Status contract
 *
 * Copied verbatim from `audit-partner-payout-quantity`: writes are honoured
 * only on Draft or Pending. Nothing Approved, Under_Review or Paid is ever
 * edited — the money there has moved or been committed, and rewriting the row
 * would make our record disagree with what was actually paid without putting a
 * rupee in anyone's hand.
 */
export type UpdatePaymentSubmissionItemInput = {
  submission_id: string
  item_id: string
  /** Units this line pays for. */
  quantity?: number
  /** The agreed rate per unit. `amount` becomes quantity x this. */
  unit_amount?: number
  /**
   * An explicit line TOTAL. Wins over `unit_amount` exactly as a cost override
   * does at create, and clears `unit_amount` for the same reason: there is no
   * recorded rate behind a typed total, and dividing it back out invents one.
   */
  amount?: number
  /**
   * The runs this line pays for. `[]` is a real value meaning "this line names
   * no runs" — which is why it is checked against the runless guard rather
   * than waved through as an absence.
   */
  production_run_ids?: string[]
  metadata?: Record<string, any>
}

/**
 * Submission statuses whose money has not moved yet, and therefore the only
 * ones a line may be rewritten on. The same two values `UNPAID_STATUSES` in
 * `audit-partner-payout-quantity-job` names — restated here rather than
 * imported so a workflow does not reach up into the API layer for a constant.
 */
const EDITABLE_STATUSES = ["Draft", "Pending"]

type PriorRun = {
  id: string
  design_id?: string | null
  partner_id?: string | null
  status?: string | null
}

const validateItemEditStep = createStep(
  "validate-payment-submission-item-edit",
  async (input: UpdatePaymentSubmissionItemInput, { container }) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    const [submission] = await service.listPaymentSubmissions(
      { id: [input.submission_id] },
      { relations: ["items"] }
    )

    if (!submission) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Payment submission not found: ${input.submission_id}`
      )
    }

    if (!EDITABLE_STATUSES.includes(String(submission.status))) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `A line on a ${submission.status} submission cannot be edited — the money has moved or been committed. Only Draft and Pending submissions are editable.`
      )
    }

    const items = ((submission as any).items || []) as any[]
    const item = items.find((i) => String(i.id) === String(input.item_id))
    if (!item) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Payment submission item not found on this submission: ${input.item_id}`
      )
    }

    // Nothing below can be true of a run claim on a task line, and silently
    // accepting one would record a run against work no run produced.
    if (input.production_run_ids && !item.design_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Production runs can only be recorded against a design-sourced line."
      )
    }

    if (input.production_run_ids) {
      const designId = String(item.design_id)
      const runIds = [
        ...new Set(input.production_run_ids.map(String).filter(Boolean)),
      ]

      /**
       * What this edited line will claim, for the quantity-aware run guard
       * (#1596). The edit's quantity when it states one, otherwise the line's
       * existing quantity — an edit that touches only the run ids has not
       * changed how many units the line bills.
       */
      const claimedQuantity =
        input.quantity !== undefined ? input.quantity : item.quantity

      if (runIds.length) {
        /**
         * 1. The runs must exist, be this partner's, be this design's, and be
         *    finished — the same four questions create asks. A claim on a run
         *    that is none of those is not a correction, it is a new fiction.
         */
        const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: runs } = await query.graph({
          entity: "production_runs",
          fields: ["id", "design_id", "partner_id", "status"],
          filters: { id: runIds },
        })

        const byId = new Map(
          ((runs || []) as PriorRun[]).map((r) => [String(r.id), r])
        )

        for (const runId of runIds) {
          const run = byId.get(runId)
          if (!run) {
            throw new MedusaError(
              MedusaError.Types.NOT_FOUND,
              `Production run not found: ${runId}`
            )
          }
          if (String(run.design_id || "") !== designId) {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              `Production run ${runId} does not belong to design ${designId}`
            )
          }
          if (
            run.partner_id &&
            String(run.partner_id) !== String(submission.partner_id)
          ) {
            throw new MedusaError(
              MedusaError.Types.NOT_ALLOWED,
              `Production run ${runId} does not belong to this partner`
            )
          }
          if (String(run.status || "") !== "completed") {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              `Production run ${runId} is not completed (${run.status})`
            )
          }
        }
      }

      /**
       * 2 & 3. Both halves of "already paid for", against every OTHER
       *        submission. This submission's own lines are excluded — a claim
       *        cannot conflict with itself, and the line being edited would
       *        otherwise block its own correction.
       */
      const priorItems = (await service.listPaymentSubmissionItems(
        { design_id: [designId] },
        { relations: ["submission"] }
      )) as any[]

      const foreignPriors = (priorItems || []).filter(
        (prior) =>
          String(prior.submission?.id || prior.submission_id || "") !==
          String(input.submission_id)
      )

      /**
       * 🔴 Scoped by PARTNER rather than by this line's design. `foreignPriors`
       * above is design-scoped and stays that way for the runless check, which
       * IS a question about designs — but a run claimed by a line sourced from
       * something other than a design carries `design_id: null` and would be
       * invisible to it. See `lib/run-claims`.
       */
      if (runIds.length) {
        const tallies = await listPartnerRunTallies(
          service as any,
          String(submission.partner_id || ""),
          { excludeSubmissionId: String(input.submission_id) }
        )

        // #1596 — quantity-aware, same rule as create and submit. The edited
        // line's own quantity is what it claims; one run plus a quantity is a
        // partial claim, anything else takes the run whole.
        const overclaimed = assessRunClaims({
          requestedByRun: requestedRunQuantities([
            { production_run_ids: runIds, quantity: claimedQuantity },
          ]),
          runs: await listRunOrderedQuantities(container, runIds),
          tallies,
        })
        if (overclaimed.length) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            runsOverclaimedMessage(overclaimed)
          )
        }
      }

      const conflicts = designsBilledWithoutRunEvidence({
        design_ids: [designId],
        claimed_runs: { [designId]: runIds },
        prior_lines: foreignPriors.map((prior) => ({
          design_id: prior.design_id ? String(prior.design_id) : null,
          submission_status: prior.submission?.status ?? null,
          submission_id: prior.submission?.id ?? prior.submission_id ?? null,
          run_provenance: prior.run_provenance ?? null,
        })),
      })

      if (conflicts.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          runlessResubmitMessage(conflicts)
        )
      }
    }

    return new StepResponse({ submission, item })
  }
)

const applyItemEditStep = createStep(
  "apply-payment-submission-item-edit",
  async (
    input: {
      edit: UpdatePaymentSubmissionItemInput
      item: any
    },
    { container }
  ) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    const { edit, item } = input

    const previous = {
      id: String(item.id),
      amount: Number(item.amount ?? 0),
      quantity: Number(item.quantity ?? 1),
      unit_amount:
        item.unit_amount === null || item.unit_amount === undefined
          ? null
          : Number(item.unit_amount),
      production_run_ids: (item.production_run_ids ?? null) as any,
      run_provenance: item.run_provenance ?? null,
      metadata: item.metadata ?? null,
    }

    /**
     * Money is recomputed through the SAME resolver create uses, so an edited
     * line and a created one cannot disagree about what "9 x 850" costs. An
     * unsupplied field keeps its current value rather than reverting to a
     * default — a PATCH that silently reset the rate would be a worse defect
     * than the one this route fixes.
     */
    const quantity =
      edit.quantity !== undefined ? edit.quantity : previous.quantity

    /**
     * A line whose amount was TYPED carries no rate (`unit_amount` is null by
     * design — see `resolveDesignLineAmount`). Changing only its quantity
     * therefore cannot change what it bills: there is nothing to multiply, and
     * inventing a rate by dividing the total back out is precisely what that
     * null exists to prevent. The quantity is descriptive on such a line, so it
     * moves and the amount stands.
     */
    const rate =
      edit.unit_amount !== undefined
        ? edit.unit_amount
        : edit.amount !== undefined
          ? null
          : previous.unit_amount

    const line =
      edit.amount === undefined && rate === null
        ? { amount: previous.amount, quantity, unit_amount: null }
        : resolveDesignLineAmount({
            unit_cost: 0,
            quantity,
            override: edit.amount,
            unit_override: rate,
          })

    if (!(line.amount > 0)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "An edited line must bill a positive amount — send either a total (amount) or a rate (unit_amount)."
      )
    }

    const update: Record<string, any> = {
      id: previous.id,
      amount: line.amount,
      quantity: line.quantity,
      unit_amount: line.unit_amount,
    }

    if (edit.production_run_ids) {
      const runIds = [
        ...new Set(edit.production_run_ids.map(String).filter(Boolean)),
      ]
      update.production_run_ids = (runIds.length ? runIds : null) as any
      /**
       * Stated, never inferred — the whole reason `run_provenance` is a column.
       * Clearing the runs on a design line does NOT make it `no_run`: the work
       * still came from production, we simply stopped saying which run. That is
       * `not_recorded`, and it is what keeps the next claim honest. #1565
       */
      update.run_provenance = runIds.length ? "recorded" : "not_recorded"
    }

    if (edit.metadata) {
      update.metadata = { ...(previous.metadata || {}), ...edit.metadata }
    }

    await service.updatePaymentSubmissionItems(update)

    return new StepResponse(undefined, previous)
  },
  async (previous: any, { container }) => {
    if (!previous) return
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    await service.updatePaymentSubmissionItems(previous)
  }
)

/**
 * The submission total is the sum of its lines, so editing one and leaving the
 * header alone would leave the screen showing a total that no longer adds up —
 * and the reconciliation record compares against exactly that number.
 */
const recomputeSubmissionTotalStep = createStep(
  "recompute-payment-submission-total",
  async (input: { submission_id: string }, { container }) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    const [before] = await service.listPaymentSubmissions({
      id: [input.submission_id],
    })

    const items = (await service.listPaymentSubmissionItems({
      submission_id: [input.submission_id],
    })) as any[]

    const total =
      Math.round(
        (items || []).reduce((sum, i) => sum + Number(i.amount ?? 0), 0) * 100
      ) / 100

    await service.updatePaymentSubmissions({
      id: input.submission_id,
      total_amount: total,
    })

    return new StepResponse(undefined, {
      submission_id: input.submission_id,
      previous_total: Number(before?.total_amount ?? 0),
    })
  },
  async (rollback: any, { container }) => {
    if (!rollback) return
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    await service.updatePaymentSubmissions({
      id: rollback.submission_id,
      total_amount: rollback.previous_total,
    })
  }
)

/** Re-read, rather than echo. See the note on `submit-payment-submission`. */
const readSubmissionBackStep = createStep(
  "read-submission-back-after-item-edit",
  async (input: { submission_id: string }, { container }) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    const [submission] = await service.listPaymentSubmissions(
      { id: [input.submission_id] },
      { relations: ["items"] }
    )
    return new StepResponse(submission)
  }
)

export const updatePaymentSubmissionItemWorkflow = createWorkflow(
  "update-payment-submission-item",
  (input: UpdatePaymentSubmissionItemInput) => {
    const validated = validateItemEditStep(input)

    applyItemEditStep({ edit: input, item: validated.item })

    recomputeSubmissionTotalStep({ submission_id: input.submission_id })

    const submission = readSubmissionBackStep({
      submission_id: input.submission_id,
    })

    return new WorkflowResponse({ submission })
  }
)
