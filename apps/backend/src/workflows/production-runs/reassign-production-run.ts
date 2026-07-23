import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { TASKS_MODULE } from "../../modules/tasks"

/**
 * #1093 — move a run into the admin reassignment queue.
 *
 * Triggered when the assigned partner never accepted (2 reminders sent, then
 * capped) or explicitly declined. The run is NOT cancelled — the work still
 * needs doing — it is unassigned and parked in `awaiting_reassignment` so an
 * admin can re-dispatch it to a new partner (reuses dispatch-production-run).
 *
 * Deliberately does NOT mirror the order as cancelled (unlike the old decline
 * path): the customer's order is unaffected by one partner stepping away.
 */

export type ReassignSource = "reminder_cap" | "decline"

export type ReassignProductionRunInput = {
  production_run_id: string
  /** Raw reason code (e.g. decline reason, or "reminder_cap"). */
  reason: string
  source: ReassignSource
  /** The partner being unassigned (for the emitted events / audit). */
  partner_id?: string | null
  /** Attribution-prefixed reason string stored on the run for the admin feed. */
  composed_reason?: string
  notes?: string
}

type ReassignComp = {
  id: string
  prev_status: string
  prev_partner_id: string | null
  prev_previous_partner_id: string | null
  prev_cancelled_reason: string | null
  prev_reminder_count: number
  prev_reminder_kind: string | null
  prev_reminder_status: string | null
}

/**
 * Unassign the partner and park the run in awaiting_reassignment. Resets the
 * reminder cycle (a fresh partner starts its own). Compensation restores the
 * prior assignment + reminder state.
 */
const parkForReassignmentStep = createStep(
  "reassign-park-run",
  async (
    input: {
      production_run_id: string
      composed_reason?: string
    },
    { container }
  ) => {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const run = (await service.retrieveProductionRun(input.production_run_id)) as any

    await service.updateProductionRuns({
      id: input.production_run_id,
      status: "awaiting_reassignment",
      // Preserve who it came from for audit; clear the live assignment so the
      // run drops out of partner-scoped queries and the reminder buckets.
      previous_partner_id: run.partner_id ?? run.previous_partner_id ?? null,
      partner_id: null,
      // Close the reminder cycle — the next partner reminds from zero.
      reminder_count: 0,
      reminder_kind: null,
      reminder_status: "closed",
      ...(input.composed_reason
        ? { cancelled_reason: input.composed_reason }
        : {}),
    })

    return new StepResponse<{ ok: boolean; previous_partner_id: string | null }, ReassignComp>(
      { ok: true, previous_partner_id: run.partner_id ?? null },
      {
        id: input.production_run_id,
        prev_status: run.status,
        prev_partner_id: run.partner_id ?? null,
        prev_previous_partner_id: run.previous_partner_id ?? null,
        prev_cancelled_reason: run.cancelled_reason ?? null,
        prev_reminder_count: run.reminder_count ?? 0,
        prev_reminder_kind: run.reminder_kind ?? null,
        prev_reminder_status: run.reminder_status ?? null,
      }
    )
  },
  async (comp: ReassignComp | undefined, { container }) => {
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
    })
  }
)

/**
 * Cancel the departing partner's non-terminal tasks — a clean slate for
 * re-dispatch (mirrors the prior decline behaviour). Forward-only.
 */
const cancelReassignedTasksStep = createStep(
  "reassign-cancel-tasks",
  async (input: { production_run_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const taskService: any = container.resolve(TASKS_MODULE)
    const { data } = await query.graph({
      entity: "production_runs",
      fields: ["tasks.id", "tasks.status"],
      filters: { id: input.production_run_id },
    })
    let cancelled = 0
    for (const t of data?.[0]?.tasks || []) {
      if (t.status !== "completed" && t.status !== "cancelled") {
        await taskService.updateTasks({ id: t.id, status: "cancelled" })
        cancelled++
      }
    }
    return new StepResponse({ cancelled })
  }
)

/**
 * Emit reassignment_needed (drives the admin queue / notification) and, when
 * the trigger was a partner decline, the declined event too (audit + any
 * existing decline listeners). Non-fatal.
 */
const emitReassignEventsStep = createStep(
  "reassign-emit-events",
  async (input: ReassignProductionRunInput, { container }) => {
    try {
      const eventService: any = container.resolve(Modules.EVENT_BUS)
      const events: Array<{ name: string; data: Record<string, any> }> = [
        {
          name: "production_run.reassignment_needed",
          data: {
            id: input.production_run_id,
            production_run_id: input.production_run_id,
            previous_partner_id: input.partner_id ?? null,
            source: input.source,
            reason: input.reason,
            notes: input.notes,
          },
        },
      ]
      if (input.source === "decline") {
        events.push({
          name: "production_run.declined",
          data: {
            id: input.production_run_id,
            production_run_id: input.production_run_id,
            partner_id: input.partner_id ?? null,
            action: "declined",
            reason: input.reason,
            notes: input.notes,
          },
        })
      }
      await eventService.emit(events)
    } catch {
      /* non-fatal */
    }
    return new StepResponse({ ok: true })
  }
)

export const reassignProductionRunWorkflow = createWorkflow(
  "reassign-production-run",
  (input: ReassignProductionRunInput) => {
    parkForReassignmentStep({
      production_run_id: input.production_run_id,
      composed_reason: input.composed_reason,
    })
    cancelReassignedTasksStep({ production_run_id: input.production_run_id })
    emitReassignEventsStep(input)

    return new WorkflowResponse({ ok: true })
  }
)

export default reassignProductionRunWorkflow
