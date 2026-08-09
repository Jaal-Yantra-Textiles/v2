import { MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { PRODUCTION_POLICY_MODULE } from "../../modules/production_policy"
import type ProductionPolicyService from "../../modules/production_policy/service"
import { PARTNER_MODULE } from "../../modules/partner"

/**
 * #1228 — the manual half of #1093's reassignment story.
 *
 * #1093 built the automatic path (reminders → cap → park in
 * `awaiting_reassignment`, partner unassigned, tasks cancelled) but nothing
 * that moves a parked run back OUT. This workflow is that missing half: an
 * admin points the run at a partner — the same one who let it go stale, or a
 * different one — and it lands back on `approved`, ready for the ordinary
 * dispatch flow.
 *
 * Deliberately stops at `approved` rather than dispatching itself. Dispatch is
 * what collects template names, and template names are what seed the partner's
 * tasks; short-circuiting it would hand a partner a run with no work items.
 */

export type AssignProductionRunPartnerSource = "manual" | "reminder_retry"

export type AssignProductionRunPartnerInput = {
  production_run_id: string
  partner_id: string
  /** Free-text admin note, recorded on the activity feed. */
  note?: string | null
  source?: AssignProductionRunPartnerSource
}

type AssignComp = {
  id: string
  prev_status: string
  prev_partner_id: string | null
  prev_previous_partner_id: string | null
  prev_cancelled_reason: string | null
  prev_reminder_count: number
  prev_reminder_kind: string | null
  prev_reminder_status: string | null
  prev_reassign_retry_count: number
  prev_dispatch_state: string | null
  prev_dispatch_started_at: Date | null
  prev_dispatch_completed_at: Date | null
}

/**
 * Validate the partner exists before we point a run at it — a typo'd id would
 * otherwise park the run against a partner that can never see it.
 */
const assertPartnerExistsStep = createStep(
  "assign-partner-assert-exists",
  async (input: { partner_id: string }, { container }) => {
    const partnerService: any = container.resolve(PARTNER_MODULE)
    const partner = await partnerService
      .retrievePartner(input.partner_id)
      .catch(() => null)

    if (!partner) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Partner ${input.partner_id} not found`
      )
    }

    return new StepResponse({ id: partner.id, name: partner.name ?? null })
  }
)

/**
 * Point the run at the partner and reset it to a dispatchable state.
 *
 * `previous_partner_id` keeps whoever last held it (so a same-partner retry is
 * still legible in the audit trail), the reminder cycle restarts from zero, and
 * the retry budget resets — each partner earns their own.
 */
const assignPartnerStep = createStep(
  "assign-production-run-partner",
  async (input: AssignProductionRunPartnerInput, { container }) => {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const policy: ProductionPolicyService = container.resolve(PRODUCTION_POLICY_MODULE)

    const run = (await service.retrieveProductionRun(input.production_run_id)) as any
    await policy.assertCanAssignPartner(run)

    const previousPartnerId = run.partner_id ?? run.previous_partner_id ?? null
    const isSamePartner = previousPartnerId === input.partner_id

    await service.updateProductionRuns({
      id: input.production_run_id,
      partner_id: input.partner_id,
      previous_partner_id: previousPartnerId,
      // Back to the one status the dispatch flow accepts, with the dispatch
      // cycle rewound to untouched. All three matter: `dispatch_state` is a
      // non-nullable enum, and the admin Dispatch button additionally hides
      // itself unless `dispatch_completed_at` is clear — so a run that was
      // already dispatched once would otherwise be assigned to a new partner
      // and then offer no way to actually send it.
      status: "approved",
      dispatch_state: "idle",
      dispatch_started_at: null,
      dispatch_completed_at: null,
      // The partner never accepted (the policy refuses to reassign once they
      // have), so this is only ever clearing a stale value.
      accepted_at: null,
      // The park reason described the PREVIOUS partner's failure; it would read
      // as a live warning against the new one.
      cancelled_reason: null,
      reminder_count: 0,
      reminder_kind: null,
      reminder_status: null,
      last_reminded_at: null,
      reassign_retry_count: 0,
    })

    return new StepResponse<
      { ok: boolean; previous_partner_id: string | null; same_partner: boolean },
      AssignComp
    >(
      {
        ok: true,
        previous_partner_id: previousPartnerId,
        same_partner: isSamePartner,
      },
      {
        id: input.production_run_id,
        prev_status: run.status,
        prev_partner_id: run.partner_id ?? null,
        prev_previous_partner_id: run.previous_partner_id ?? null,
        prev_cancelled_reason: run.cancelled_reason ?? null,
        prev_reminder_count: run.reminder_count ?? 0,
        prev_reminder_kind: run.reminder_kind ?? null,
        prev_reminder_status: run.reminder_status ?? null,
        prev_reassign_retry_count: run.reassign_retry_count ?? 0,
        prev_dispatch_state: run.dispatch_state ?? null,
        prev_dispatch_started_at: run.dispatch_started_at ?? null,
        prev_dispatch_completed_at: run.dispatch_completed_at ?? null,
      }
    )
  },
  async (comp: AssignComp | undefined, { container }) => {
    if (!comp) return
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    await service.updateProductionRuns({
      id: comp.id,
      status: comp.prev_status as any,
      partner_id: comp.prev_partner_id,
      previous_partner_id: comp.prev_previous_partner_id,
      cancelled_reason: comp.prev_cancelled_reason,
      reminder_count: comp.prev_reminder_count,
      reminder_kind: comp.prev_reminder_kind,
      reminder_status: comp.prev_reminder_status as any,
      reassign_retry_count: comp.prev_reassign_retry_count,
      dispatch_state: comp.prev_dispatch_state as any,
      dispatch_started_at: comp.prev_dispatch_started_at,
      dispatch_completed_at: comp.prev_dispatch_completed_at,
    })
  }
)

/**
 * Drives the admin activity feed and any notification listeners. Non-fatal —
 * the assignment itself has already committed.
 */
const emitAssignedEventStep = createStep(
  "assign-partner-emit-event",
  async (
    input: AssignProductionRunPartnerInput & { previous_partner_id: string | null },
    { container }
  ) => {
    try {
      const eventService: any = container.resolve(Modules.EVENT_BUS)
      await eventService.emit([
        {
          name: "production_run.partner_assigned",
          data: {
            id: input.production_run_id,
            production_run_id: input.production_run_id,
            partner_id: input.partner_id,
            previous_partner_id: input.previous_partner_id,
            same_partner: input.previous_partner_id === input.partner_id,
            source: input.source ?? "manual",
            note: input.note ?? null,
          },
        },
      ])
    } catch {
      /* non-fatal */
    }
    return new StepResponse({ ok: true })
  }
)

export const assignProductionRunPartnerWorkflow = createWorkflow(
  "assign-production-run-partner",
  (input: AssignProductionRunPartnerInput) => {
    assertPartnerExistsStep({ partner_id: input.partner_id })

    const assigned = assignPartnerStep(input)

    emitAssignedEventStep({
      production_run_id: input.production_run_id,
      partner_id: input.partner_id,
      note: input.note,
      source: input.source,
      previous_partner_id: assigned.previous_partner_id,
    })

    return new WorkflowResponse(assigned)
  }
)

export default assignProductionRunPartnerWorkflow
