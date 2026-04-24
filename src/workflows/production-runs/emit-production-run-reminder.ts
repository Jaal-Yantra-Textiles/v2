import { Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import type { IEventBusModuleService } from "@medusajs/types"

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

type EmitStepResult = {
  emitted: boolean
  event: string | null
  reason: string | null
}

const emitReminderEventStep = createStep(
  "emit-production-run-reminder-event",
  async (input: EmitProductionRunReminderInput, { container }) => {
    const eventName = REMINDER_EVENT_BY_KIND[input.reminder_kind]
    if (!eventName) {
      return new StepResponse<EmitStepResult>({
        emitted: false,
        event: null,
        reason: "unknown_reminder_kind",
      })
    }
    if (!input.production_run_id || !input.partner_id) {
      return new StepResponse<EmitStepResult>({
        emitted: false,
        event: eventName,
        reason: "missing_required_ids",
      })
    }

    const eventService = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
    await eventService.emit([
      {
        name: eventName,
        data: {
          production_run_id: input.production_run_id,
          partner_id: input.partner_id,
          design_id: input.design_id ?? null,
          reminder_kind: input.reminder_kind,
        },
      },
    ])

    return new StepResponse<EmitStepResult>({
      emitted: true,
      event: eventName,
      reason: null,
    })
  }
)

export const emitProductionRunReminderWorkflow = createWorkflow(
  "emit-production-run-reminder",
  (input: EmitProductionRunReminderInput) => {
    const result = emitReminderEventStep(input)
    return new WorkflowResponse(result)
  }
)

export default emitProductionRunReminderWorkflow
