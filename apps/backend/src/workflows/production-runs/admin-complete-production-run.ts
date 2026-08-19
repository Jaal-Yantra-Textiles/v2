/**
 * Admin: complete a production run on the partner's behalf, from a message.
 *
 * Why this exists as its own workflow rather than a few writes in the route.
 *
 * `completeProductionRunWorkflow` gates on `assertCanCompleteWork`, which
 * requires BOTH `status ∈ complete_work_from` (prod: `["in_progress"]`) and a
 * `finished_at`. In the WhatsApp-driven flow the partner never formally
 * accepted, started or finished the run in the partner app — they said so in a
 * message — so the run is typically still `sent_to_partner` with no lifecycle
 * timestamps at all. Something has to bring it to a completable state first.
 *
 * The order of operations IS the safety property here. Stamping the timestamps
 * and then letting the gate run turns a rejection into a corruption: the run is
 * left permanently claiming it was started and finished at a moment it wasn't,
 * and is pre-armed to slip past the `finished_at` gate on some later call. So:
 *
 *   1. `evaluateAdminCompletionOverride` decides — from the policy, before any
 *      write — whether this run may be overridden at all, and what the override
 *      would have to change. It is PURE, so the decision is unit-testable
 *      without a DB.
 *   2. The override is applied in a step that captures the previous values and
 *      restores them in its compensation.
 *   3. `completeProductionRunWorkflow` runs as a nested step. If it throws for
 *      any reason, the engine compensates step 2 and the run goes back to
 *      exactly the state it was in.
 *
 * The promotable set is derived from the policy rather than hardcoded, for the
 * same reason `partner-run-steps` defers to it: allowed transitions live in ONE
 * place. A run may be overridden from a status that could legitimately reach
 * `in_progress` in a single step (`accept_from`) or that is already completable
 * (`complete_work_from`). Anything else — a draft, an unapproved run, one
 * parked for reassignment — is refused with no write at all.
 */
import { MedusaError } from "@medusajs/framework/utils"
import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
} from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { PRODUCTION_POLICY_MODULE } from "../../modules/production_policy"
import type ProductionPolicyService from "../../modules/production_policy/service"
import {
  completeProductionRunWorkflow,
  type CompleteProductionRunInput,
} from "./complete-production-run"

export type AdminCompleteProductionRunInput = CompleteProductionRunInput & {
  /** Free-form partner message this completion was raised from, if any. */
  override_note?: string
}

/** The run fields the override decision reads. */
export type OverrideRunLike = {
  status?: string | null
  started_at?: Date | string | null
  finished_at?: Date | string | null
}

export type AdminCompletionOverride =
  | {
      ok: true
      /** Statuses considered completable, for messaging. */
      promote_status: boolean
      stamp_started_at: boolean
      stamp_finished_at: boolean
    }
  | { ok: false; reason: string }

const asArray = (value: unknown, fallback: string[]): string[] =>
  Array.isArray(value) ? value.map((v) => String(v)) : fallback

/**
 * PURE: may an admin complete this run on the partner's behalf, and what would
 * the override have to change? Exported for unit tests.
 *
 * Returns the plan rather than performing it, so the caller can refuse BEFORE
 * touching the row. `{ ok: false }` must leave the run untouched.
 */
export const evaluateAdminCompletionOverride = (
  run: OverrideRunLike | null | undefined,
  policyConfig: Record<string, any> | null | undefined
): AdminCompletionOverride => {
  if (!run) {
    return { ok: false, reason: "Production run not found" }
  }

  const status = String(run.status ?? "")

  if (status === "cancelled") {
    return { ok: false, reason: "Cannot complete a cancelled production run" }
  }

  if (status === "completed") {
    return { ok: false, reason: "Production run is already completed" }
  }

  const transitions = (policyConfig?.transitions ?? {}) as Record<string, any>
  const completable = asArray(transitions.complete_work_from, ["in_progress"])
  const acceptable = asArray(transitions.accept_from, ["sent_to_partner"])

  // A status the admin may promote: already completable, or one accept away
  // from being so. Deliberately NOT "anything non-terminal" — an approved or
  // draft run has never been in a partner's hands, so there is no partner
  // message that could honestly attest the work is done.
  const promotable = Array.from(new Set([...completable, ...acceptable]))

  if (!promotable.includes(status)) {
    return {
      ok: false,
      reason:
        `A production run must be ${promotable.join(" or ")} for an admin to ` +
        `complete it on the partner's behalf. Current status: ${status || "unknown"}`,
    }
  }

  return {
    ok: true,
    promote_status: !completable.includes(status),
    stamp_started_at: !run.started_at,
    stamp_finished_at: !run.finished_at,
  }
}

// ---------------------------------------------------------------------------
// Step: apply the override (compensatable)
// ---------------------------------------------------------------------------

type OverrideStepInput = {
  production_run_id: string
  partner_id: string
  override_note?: string
}

type OverrideRollback = {
  id: string
  status: any
  started_at: Date | null
  finished_at: Date | null
  finish_notes: string | null
}

export const applyAdminCompletionOverrideStep = createStep(
  "apply-admin-completion-override",
  async (input: OverrideStepInput, { container }) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )
    const productionPolicyService: ProductionPolicyService = container.resolve(
      PRODUCTION_POLICY_MODULE
    )

    const run = (await productionRunService
      .retrieveProductionRun(input.production_run_id)
      .catch(() => null)) as any

    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run ${input.production_run_id} not found`
      )
    }

    const persistedPartnerId = run.partner_id ?? run.partnerId ?? null
    if (!persistedPartnerId || persistedPartnerId !== input.partner_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run ${input.production_run_id} not found for this partner`
      )
    }

    const config = await productionPolicyService.getPolicyConfig()
    const decision = evaluateAdminCompletionOverride(run, config)

    // Refused BEFORE any write — this is the whole point of the step.
    if (!decision.ok) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, decision.reason)
    }

    if (
      !decision.promote_status &&
      !decision.stamp_started_at &&
      !decision.stamp_finished_at
    ) {
      // Already completable on its own terms — nothing to override, and so
      // nothing to compensate.
      return new StepResponse({ applied: false }, null as OverrideRollback | null)
    }

    const rollback: OverrideRollback = {
      id: run.id,
      status: run.status,
      started_at: run.started_at ?? null,
      finished_at: run.finished_at ?? null,
      finish_notes: run.finish_notes ?? null,
    }

    const now = new Date()
    const update: Record<string, any> = { id: run.id }

    if (decision.promote_status) {
      update.status = "in_progress"
      if (!run.accepted_at) {
        update.accepted_at = now
      }
    }
    if (decision.stamp_started_at) {
      update.started_at = now
    }
    if (decision.stamp_finished_at) {
      update.finished_at = now
      update.finish_notes = input.override_note
        ? `Completed via WhatsApp — partner message: ${input.override_note.substring(0, 200)}`
        : "Completed via WhatsApp (admin override)"
    }

    await productionRunService.updateProductionRuns(update as any)

    return new StepResponse({ applied: true }, rollback)
  },
  async (rollback: OverrideRollback | null | undefined, { container }) => {
    if (!rollback) {
      return
    }

    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    // Restore verbatim, nulls included — a stamp we added must come back OFF,
    // not merely stay at whatever the failed completion left behind.
    await productionRunService.updateProductionRuns({
      id: rollback.id,
      status: rollback.status,
      started_at: rollback.started_at,
      finished_at: rollback.finished_at,
      finish_notes: rollback.finish_notes,
    } as any)
  }
)

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export const adminCompleteProductionRunWorkflow = createWorkflow(
  "admin-complete-production-run",
  function (input: AdminCompleteProductionRunInput) {
    applyAdminCompletionOverrideStep({
      production_run_id: input.production_run_id,
      partner_id: input.partner_id,
      override_note: input.override_note,
    })

    // Nested so that ANY failure inside the completion compensates the
    // override above and puts the run back exactly as it was.
    const completed = completeProductionRunWorkflow.runAsStep({ input })

    return new WorkflowResponse(completed)
  }
)
