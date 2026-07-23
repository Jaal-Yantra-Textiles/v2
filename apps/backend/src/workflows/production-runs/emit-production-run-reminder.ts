import { Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import type { IEventBusModuleService } from "@medusajs/types"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { reassignProductionRunWorkflow } from "./reassign-production-run"

export type ReminderKind = "assignment_pending" | "not_started" | "idle"

export type EmitProductionRunReminderInput = {
  production_run_id: string
  partner_id: string
  design_id?: string | null
  reminder_kind: ReminderKind
}

const REMINDER_EVENT_BY_KIND: Record<ReminderKind, string> = {
  assignment_pending: "production_run.reminder_assignment_pending",
  not_started: "production_run.reminder_not_started",
  idle: "production_run.reminder_idle",
}

/**
 * #1093 — after this many reminders in a single bucket the run stops being
 * nagged and escalates: assignment_pending → reassignment queue; an
 * already-accepted run (not_started / idle) → admin escalation.
 */
export const REMINDER_CAP = 2

type EmitAction = "reminded" | "reassigned" | "escalated" | "skipped"

type EmitStepResult = {
  action: EmitAction
  event: string | null
  reminder_count: number
  reason: string | null
}

/**
 * Pure decision: given the run's current reminder state and the classified
 * kind, decide what to do. Exported for unit testing.
 *
 *   - fresh bucket (stored kind differs) → count resets to 0
 *   - already escalated for this kind → skip (no repeat escalation)
 *   - count < CAP → send another reminder (count+1)
 *   - count >= CAP → assignment_pending reassigns; others escalate
 */
export function decideReminderAction(
  run: {
    reminder_kind?: string | null
    reminder_count?: number | null
    reminder_status?: string | null
  },
  kind: ReminderKind,
  cap: number = REMINDER_CAP
): { action: EmitAction; nextCount: number } {
  const sameBucket = run.reminder_kind === kind
  const effectiveCount = sameBucket ? run.reminder_count ?? 0 : 0

  if (sameBucket && run.reminder_status === "escalated") {
    // Already escalated on a prior run — don't nag or re-escalate.
    return { action: "skipped", nextCount: effectiveCount }
  }

  if (effectiveCount >= cap) {
    return {
      action: kind === "assignment_pending" ? "reassigned" : "escalated",
      nextCount: effectiveCount,
    }
  }

  return { action: "reminded", nextCount: effectiveCount + 1 }
}

const processReminderStep = createStep(
  "process-production-run-reminder",
  async (input: EmitProductionRunReminderInput, { container }) => {
    const eventName = REMINDER_EVENT_BY_KIND[input.reminder_kind]
    if (!eventName) {
      return new StepResponse<EmitStepResult>({
        action: "skipped",
        event: null,
        reminder_count: 0,
        reason: "unknown_reminder_kind",
      })
    }
    if (!input.production_run_id || !input.partner_id) {
      return new StepResponse<EmitStepResult>({
        action: "skipped",
        event: eventName,
        reminder_count: 0,
        reason: "missing_required_ids",
      })
    }

    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const run = (await service
      .retrieveProductionRun(input.production_run_id)
      .catch(() => null)) as any
    if (!run) {
      return new StepResponse<EmitStepResult>({
        action: "skipped",
        event: eventName,
        reminder_count: 0,
        reason: "run_not_found",
      })
    }

    const { action, nextCount } = decideReminderAction(run, input.reminder_kind)
    const eventService = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService

    if (action === "skipped") {
      return new StepResponse<EmitStepResult>({
        action,
        event: eventName,
        reminder_count: nextCount,
        reason: "already_escalated",
      })
    }

    if (action === "reminded") {
      await eventService.emit([
        {
          name: eventName,
          data: {
            production_run_id: input.production_run_id,
            partner_id: input.partner_id,
            design_id: input.design_id ?? null,
            reminder_kind: input.reminder_kind,
            reminder_count: nextCount,
          },
        },
      ])
      await service.updateProductionRuns({
        id: input.production_run_id,
        reminder_count: nextCount,
        reminder_kind: input.reminder_kind,
        reminder_status: "active",
        last_reminded_at: new Date(),
      })
      return new StepResponse<EmitStepResult>({
        action,
        event: eventName,
        reminder_count: nextCount,
        reason: null,
      })
    }

    if (action === "reassigned") {
      // Cap hit on an unaccepted run → send it to the reassignment queue.
      await reassignProductionRunWorkflow(container).run({
        input: {
          production_run_id: input.production_run_id,
          partner_id: input.partner_id,
          source: "reminder_cap",
          reason: "reminder_cap_reached",
          composed_reason: `Auto-reassigned: no response after ${REMINDER_CAP} reminders`,
        },
      })
      return new StepResponse<EmitStepResult>({
        action,
        event: "production_run.reassignment_needed",
        reminder_count: nextCount,
        reason: null,
      })
    }

    // action === "escalated" — accepted run gone quiet past the cap. Flag for
    // admin follow-up (no reassignment — the partner still holds the work).
    await eventService.emit([
      {
        name: "production_run.reminder_escalated",
        data: {
          production_run_id: input.production_run_id,
          partner_id: input.partner_id,
          design_id: input.design_id ?? null,
          reminder_kind: input.reminder_kind,
          reminder_count: nextCount,
        },
      },
    ])
    await service.updateProductionRuns({
      id: input.production_run_id,
      reminder_kind: input.reminder_kind,
      reminder_status: "escalated",
    })
    return new StepResponse<EmitStepResult>({
      action,
      event: "production_run.reminder_escalated",
      reminder_count: nextCount,
      reason: null,
    })
  }
)

export const emitProductionRunReminderWorkflow = createWorkflow(
  "emit-production-run-reminder",
  (input: EmitProductionRunReminderInput) => {
    const result = processReminderStep(input)
    return new WorkflowResponse(result)
  }
)

export default emitProductionRunReminderWorkflow
