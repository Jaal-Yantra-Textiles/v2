import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { DESIGN_MODULE } from "../../modules/designs"
import { PARTNER_MODULE } from "../../modules/partner"
import { TASKS_MODULE } from "../../modules/tasks"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"

export type CancelPartnerAssignmentInput = {
  design_id: string
  partner_id: string
  unlink?: boolean
}

/**
 * Cancel the partner's active (non-terminal) production runs for this
 * design, plus their open tasks. Cancellation IS the run's own state
 * (single source of truth) — there is no separate assignment flag.
 */
const cancelPartnerRunsStep = createStep(
  "cpa-cancel-partner-runs",
  async (input: { design_id: string; partner_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
    const taskService: any = container.resolve(TASKS_MODULE)

    const { data: runs } = await query.graph({
      entity: "production_runs",
      filters: {
        design_id: input.design_id,
        partner_id: input.partner_id,
        status: { $nin: ["completed", "cancelled"] },
      },
      fields: ["id"],
    })
    const ids: string[] = []
    let cancelledTasks = 0
    for (const run of runs || []) {
      await runService.updateProductionRuns({
        id: run.id,
        status: "cancelled",
        cancelled_at: new Date(),
        cancelled_reason: "partner_assignment_cancelled",
      })
      ids.push(run.id)
      const { data: rd } = await query.graph({
        entity: "production_runs",
        fields: ["tasks.id", "tasks.status"],
        filters: { id: run.id },
      })
      for (const t of rd?.[0]?.tasks || []) {
        if (t.status !== "completed" && t.status !== "cancelled") {
          await taskService.updateTasks({ id: t.id, status: "cancelled" })
          cancelledTasks++
        }
      }
    }
    return new StepResponse({ cancelled_runs: ids.length, cancelled_tasks: cancelledTasks })
  }
)

/** Optionally unlink the partner from the design. Compensation re-links. */
type UnlinkComp = Record<string, Record<string, string>>
const unlinkPartnerStep = createStep(
  "cpa-unlink-partner",
  async (
    input: { design_id: string; partner_id: string; unlink?: boolean },
    { container }
  ) => {
    if (!input.unlink) {
      return new StepResponse<{ unlinked: boolean }, UnlinkComp>({ unlinked: false })
    }
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    const def: UnlinkComp = {
      [DESIGN_MODULE]: { design_id: input.design_id },
      [PARTNER_MODULE]: { partner_id: input.partner_id },
    }
    await remoteLink.dismiss(def)
    return new StepResponse<{ unlinked: boolean }, UnlinkComp>({ unlinked: true }, def)
  },
  async (def: UnlinkComp | undefined, { container }) => {
    if (!def) return
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.create(def)
  }
)

export const cancelPartnerAssignmentWorkflow = createWorkflow(
  "cancel-partner-assignment",
  (input: CancelPartnerAssignmentInput) => {
    const runs = cancelPartnerRunsStep({
      design_id: input.design_id,
      partner_id: input.partner_id,
    })
    const unlinked = unlinkPartnerStep({
      design_id: input.design_id,
      partner_id: input.partner_id,
      unlink: input.unlink,
    })

    return new WorkflowResponse({
      cancelled_tasks: runs.cancelled_tasks,
      cancelled_runs: runs.cancelled_runs,
      unlinked: unlinked.unlinked,
    })
  }
)
