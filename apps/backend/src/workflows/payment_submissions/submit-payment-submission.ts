import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/types"

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

/**
 * Turn a Draft payment submission into a real claim — Draft → Pending, in place.
 *
 * ## Why this exists (#1604, and the reason #1605 is a workaround)
 *
 * `auto-draft-payment-submission` writes a Draft on every completed run: the
 * design, the partner, the rate, the quantity AND the run ids, all recorded.
 * That draft is deliberately not a claim on anyone — the partner reviews it and
 * submits when they're ready.
 *
 * Except there was no way to submit it. The only routes were create, review and
 * two GETs, so "submitting" meant creating a SECOND submission by hand — which
 * could not name the runs (the Draft already holds a live claim on them, so the
 * run-level guard refuses), and therefore had to name none. #1602 closed the
 * runless re-bill hole and, with it, the only path a drafted design had; #1605
 * reopened it by exempting Draft priors from that guard.
 *
 * That exemption is safe but it is not the answer: it means the strongest
 * evidence we hold — the run ids the subscriber knew for certain — is thrown
 * away every time a partner bills drafted work, and the line that reaches
 * review reads `run_provenance: not_recorded`. Converting the Draft in place
 * keeps the evidence and makes the runless path unnecessary.
 *
 * ## What it re-checks, and why it must
 *
 * A Draft can be minutes or months old. Between drafting and submitting, the
 * same design or the same runs may have been billed by another submission. So
 * every claim guard `create-payment-submission` runs is re-run here against the
 * submission's OWN lines — with this submission excluded from the priors, since
 * a claim cannot conflict with itself.
 *
 * 🔴 The same obligation lands on any future PATCH of `production_run_ids`. An
 * edit route that skips these checks is an open window beside a locked door.
 */
export type SubmitPaymentSubmissionInput = {
  submission_id: string
  /**
   * When present, the submission must belong to this partner. The partner route
   * passes it; the admin route does not, because an admin submitting on a
   * partner's behalf is a legitimate (and, with 7 drafts stuck on production,
   * necessary) operation.
   */
  expected_partner_id?: string
  /** Optional partner note, recorded at the moment of submission. */
  notes?: string
}

type SubmissionItem = {
  id: string
  design_id: string | null
  source_type: string | null
  production_run_ids: string[] | null
  run_provenance: string | null
}

/**
 * Step 1 — the submission is a Draft, it belongs to whoever is submitting it,
 * and nothing has claimed its designs or runs in the meantime.
 */
const validateSubmissionForSubmitStep = createStep(
  "validate-submission-for-submit",
  async (input: SubmitPaymentSubmissionInput, { container }) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    const submissions = await service.listPaymentSubmissions(
      { id: [input.submission_id] },
      { relations: ["items"] }
    )

    const submission = submissions[0]
    if (!submission) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Payment submission not found: ${input.submission_id}`
      )
    }

    if (
      input.expected_partner_id &&
      submission.partner_id !== input.expected_partner_id
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "You do not have access to this submission"
      )
    }

    /**
     * Draft is the ONLY submittable status, and the refusal says which one it
     * is in. Pending/Under_Review are already submitted; Approved, Paid and
     * Rejected are decided. A second route into Pending from any of those is
     * how a status and the money it authorised come to disagree.
     */
    if (String(submission.status) !== "Draft") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Submission cannot be submitted in status "${submission.status}". Only a Draft can be submitted.`
      )
    }

    const items = ((submission as any).items || []) as SubmissionItem[]
    if (!items.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Submission has no items to submit."
      )
    }

    const designIds = [
      ...new Set(
        items
          .filter((i) => !!i.design_id)
          .map((i) => String(i.design_id))
      ),
    ]

    /**
     * The run-level guard, lifted OUT of the `designIds.length` block below.
     *
     * 🔴 It used to sit inside it, so a submission carrying no design-sourced
     * line at all — every line keyed on something else — skipped all three
     * guards and submitted unchecked. The design gate belongs to the design
     * questions; whether a run is already claimed is not one of them.
     *
     * Scoped by partner (see `lib/run-claims`) and excluding this submission,
     * since a claim cannot conflict with itself.
     */
    const claimedRunIds = [
      ...new Set(
        items.flatMap((i) => (i.production_run_ids || []).map(String))
      ),
    ].filter(Boolean)

    if (claimedRunIds.length) {
      const tallies = await listPartnerRunTallies(
        service as any,
        String(submission.partner_id || ""),
        { excludeSubmissionId: String(input.submission_id) }
      )

      /**
       * #1596 — quantity-aware. What this submission's own lines claim is read
       * off the lines themselves (a line naming one run for N units claims N),
       * and diffed against what the run was ordered for.
       */
      const runs = await listRunOrderedQuantities(container, claimedRunIds)
      const overclaimed = assessRunClaims({
        requestedByRun: requestedRunQuantities(
          items.map((i) => ({
            production_run_ids: (i.production_run_ids || []).map(String),
            quantity: (i as any).quantity,
          }))
        ),
        runs,
        tallies,
      })
      if (overclaimed.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          runsOverclaimedMessage(overclaimed)
        )
      }
    }

    if (designIds.length) {
      /**
       * Every prior line for these designs, this submission's own excluded —
       * a claim cannot conflict with itself, and every check below would
       * otherwise refuse the draft on the strength of the draft.
       */
      const priorItems = (await service.listPaymentSubmissionItems(
        { design_id: designIds },
        { relations: ["submission"] }
      )) as any[]

      const foreignPriors = (priorItems || []).filter((item) => {
        const priorSubmissionId = String(
          item.submission?.id || item.submission_id || ""
        )
        return priorSubmissionId !== String(input.submission_id)
      })

      /**
       * 1. The design-level guard, exactly as create runs it for a Pending
       *    submission: another OPEN submission on the same design. Draft is
       *    not blocking here — a second draft of the same design is the
       *    duplicate-completion case, and refusing to submit either of them
       *    would leave both stuck, which is the shape of #1605.
       */
      const OPEN_STATUSES = new Set(["Pending", "Under_Review"])
      const openDesigns = [
        ...new Set(
          foreignPriors
            .filter((item) =>
              OPEN_STATUSES.has(String(item.submission?.status || ""))
            )
            .map((item) => String(item.design_id))
            .filter((id) => designIds.includes(id))
        ),
      ]
      if (openDesigns.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Designs already in an active payment submission: ${openDesigns.join(", ")}`
        )
      }

      /**
       * 2. The run-level guard has already run above, unconditionally and
       *    scoped by partner. It is deliberately NOT repeated here.
       */

      /**
       * 3. And the runless half of the same question (#1556). A draft line that
       *    names no runs is exactly the claim that cannot be told apart from an
       *    earlier one, so it gets the same refusal here as it would at create.
       */
      const claimedRunsByDesign: Record<string, string[]> = {}
      for (const item of items) {
        if (!item.design_id) continue
        const designId = String(item.design_id)
        claimedRunsByDesign[designId] = [
          ...(claimedRunsByDesign[designId] || []),
          ...((item.production_run_ids || []) as string[]).map(String),
        ].filter(Boolean)
      }

      const conflicts = designsBilledWithoutRunEvidence({
        design_ids: designIds,
        claimed_runs: claimedRunsByDesign,
        prior_lines: foreignPriors.map((item) => ({
          design_id: item.design_id ? String(item.design_id) : null,
          submission_status: item.submission?.status ?? null,
          submission_id: item.submission?.id ?? item.submission_id ?? null,
          run_provenance: item.run_provenance ?? null,
        })),
      })

      if (conflicts.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          runlessResubmitMessage(conflicts)
        )
      }
    }

    return new StepResponse(submission)
  }
)

/** Step 2 — Draft → Pending, with the moment it happened. */
const markSubmissionPendingStep = createStep(
  "mark-submission-pending",
  async (
    input: { submission_id: string; notes?: string },
    { container }
  ) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    const [prev] = await service.listPaymentSubmissions({
      id: [input.submission_id],
    })

    const updateData: Record<string, any> = {
      id: input.submission_id,
      status: "Pending",
      submitted_at: new Date(),
    }
    if (input.notes) {
      updateData.notes = input.notes
    }

    await service.updatePaymentSubmissions(updateData)

    return new StepResponse(undefined, {
      submission_id: input.submission_id,
      previous_status: prev?.status,
      previous_submitted_at: prev?.submitted_at ?? null,
      previous_notes: prev?.notes ?? null,
    })
  },
  async (rollback: any, { container }) => {
    if (!rollback) return
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    await service.updatePaymentSubmissions({
      id: rollback.submission_id,
      status: rollback.previous_status,
      submitted_at: rollback.previous_submitted_at,
      notes: rollback.previous_notes,
    })
  }
)

/**
 * Step 3 — read the row back.
 *
 * 🔴 NOT the object step 1 returned, and not the request body either. Step 1's
 * copy is the Draft as it was BEFORE the transition, and echoing it is exactly
 * the stale-200 the review route still ships: a caller reads `status: "Draft"`
 * off a response to the call that made it Pending, and concludes the write
 * failed.
 */
const readSubmissionBackStep = createStep(
  "read-submission-back",
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

/** Step 4 — tell the world, so the partner-notification flow can pick it up. */
const emitSubmittedEventStep = createStep(
  "emit-payment-submission-submitted",
  async (
    input: {
      submission_id: string
      partner_id: string
      total_amount: number | null
      currency: string | null
    },
    { container }
  ) => {
    const eventService = container.resolve(
      Modules.EVENT_BUS
    ) as IEventBusModuleService

    await eventService.emit([
      {
        name: "payment_submission.submitted",
        data: {
          payment_submission_id: input.submission_id,
          partner_id: input.partner_id,
          total_amount: input.total_amount,
          currency: input.currency,
        },
      },
    ])

    return new StepResponse({ emitted: true })
  }
)

export const submitPaymentSubmissionWorkflow = createWorkflow(
  "submit-payment-submission",
  (input: SubmitPaymentSubmissionInput) => {
    const draft = validateSubmissionForSubmitStep(input)

    markSubmissionPendingStep({
      submission_id: input.submission_id,
      notes: input.notes,
    })

    const submission = readSubmissionBackStep({
      submission_id: input.submission_id,
    })

    emitSubmittedEventStep({
      submission_id: input.submission_id,
      partner_id: draft.partner_id,
      total_amount: draft.total_amount,
      currency: draft.currency,
    })

    return new WorkflowResponse({ submission })
  }
)
