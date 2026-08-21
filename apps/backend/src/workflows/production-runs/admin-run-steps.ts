/**
 * Shared workflow steps for admin-side production run lifecycle actions
 * (accept, start, finish) — the admin equivalents of the partner-side
 * steps in `partner-run-steps.ts`.
 *
 * The partner steps validate ownership (`run.partner_id === input.partner_id`).
 * Admin steps do NOT — an admin acts on behalf of whichever partner is
 * assigned, so they retrieve the run, assert it is actionable, and pass
 * `run.partner_id` downstream to the existing partner workflows.
 */
import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminRunInput = {
  production_run_id: string
}

export type RetrievedAdminRun = {
  id: string
  partner_id: string
  status: string
  started_at: Date | string | null
  finished_at: Date | string | null
  accepted_at: Date | string | null
  design_id: string | null
  run_type: string | null
  lifecycle_transaction_id: string | null
}

// ---------------------------------------------------------------------------
// Step: Retrieve & validate a run for an admin action
// ---------------------------------------------------------------------------

export type AdminValidateRunOpts = {
  action: "accept" | "start" | "finish"
}

export const retrieveAndValidateAdminRunStep = createStep(
  "retrieve-and-validate-admin-run",
  async (
    input: AdminRunInput & { opts: AdminValidateRunOpts },
    { container }
  ) => {
    const productionRunService: ProductionRunService =
      container.resolve(PRODUCTION_RUNS_MODULE)

    const run = (await productionRunService
      .retrieveProductionRun(input.production_run_id)
      .catch(() => null)) as any

    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run ${input.production_run_id} not found`
      )
    }

    const status = String(run.status ?? "")

    if (status === "cancelled") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Cannot ${input.opts.action} a cancelled production run`
      )
    }

    if (status === "completed") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Cannot ${input.opts.action} a completed production run`
      )
    }

    const partnerId = run.partner_id ?? run.partnerId ?? null
    if (!partnerId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Production run ${input.production_run_id} has no assigned partner`
      )
    }

    // Action-specific idempotency guards (kept here so the route stays thin
    // and the nested partner workflow's policy assertion gets a clean shot).
    switch (input.opts.action) {
      case "accept":
        if (status === "in_progress" && run.accepted_at) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            "Production run is already accepted"
          )
        }
        break
      case "start":
        if (run.started_at) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            "Production run has already been started"
          )
        }
        break
      case "finish":
        if (!run.started_at) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            "Production run must be started before it can be finished"
          )
        }
        if (run.finished_at) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            "Production run is already finished"
          )
        }
        break
    }

    return new StepResponse({
      id: run.id,
      partner_id: partnerId,
      status,
      started_at: run.started_at ?? null,
      finished_at: run.finished_at ?? null,
      accepted_at: run.accepted_at ?? null,
      design_id: run.design_id ?? null,
      run_type: run.run_type ?? null,
      lifecycle_transaction_id: run.lifecycle_transaction_id ?? null,
    } as RetrievedAdminRun)
  }
)

// ---------------------------------------------------------------------------
// Step: Record an admin activity audit entry
// ---------------------------------------------------------------------------

export type RecordAdminActivityInput = {
  production_run_id: string
  partner_id: string
  admin_actor_id: string | null
  kind: string
  summary: string
  payload?: Record<string, any> | null
}

export const recordAdminRunActivityStep = createStep(
  "record-admin-run-activity",
  async (input: RecordAdminActivityInput, { container }) => {
    const productionRunService: ProductionRunService =
      container.resolve(PRODUCTION_RUNS_MODULE)

    await productionRunService.createProductionRunActivities({
      production_run_id: input.production_run_id,
      activity_type: "lifecycle_event",
      kind: input.kind,
      actor_type: "admin",
      actor_id: input.admin_actor_id,
      partner_id: input.partner_id,
      channel: null,
      message_id: null,
      template_name: null,
      recipient: null,
      summary: input.summary,
      payload: input.payload ?? {},
      occurred_at: new Date(),
    } as any)

    return new StepResponse({ recorded: true })
  }
)
