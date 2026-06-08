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
import { cancelWorkflowTransactionWorkflow } from "./design-steps"

const V1_TASK_TITLES = [
  "partner-design-start",
  "partner-design-redo",
  "partner-design-finish",
  "partner-design-completed",
]

export type CancelPartnerAssignmentInput = {
  design_id: string
  partner_id: string
  unlink?: boolean
}

/**
 * Cancel the legacy v1 send-to-partner workflow transaction (if any).
 * Tolerant: no-ops when the design has no v1 workflow tasks/transaction.
 */
const cancelV1TransactionStep = createStep(
  "cpa-cancel-v1-transaction",
  async (input: { design_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "design",
      filters: { id: input.design_id },
      fields: ["id", "tasks.id", "tasks.title", "tasks.transaction_id"],
    })
    const tasks = (data?.[0]?.tasks || []).filter((t: any) =>
      V1_TASK_TITLES.includes(t.title)
    )
    const transactionId =
      tasks.find((t: any) => t.transaction_id)?.transaction_id || null
    if (transactionId) {
      try {
        await cancelWorkflowTransactionWorkflow(container).run({
          input: { transactionId, updatedDesign: { id: input.design_id } },
        })
      } catch (e: any) {
        // Workflow may already be terminal — non-fatal.
        console.warn("[cancel-partner-assignment] txn cancel warning:", e.message)
      }
    }
    return new StepResponse({ transaction_id: transactionId })
  }
)

/** Cancel non-terminal v1 partner-workflow tasks. */
const cancelV1TasksStep = createStep(
  "cpa-cancel-v1-tasks",
  async (input: { design_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const taskService: any = container.resolve(TASKS_MODULE)
    const { data } = await query.graph({
      entity: "design",
      filters: { id: input.design_id },
      fields: ["id", "tasks.id", "tasks.title", "tasks.status"],
    })
    const tasks = (data?.[0]?.tasks || []).filter(
      (t: any) =>
        V1_TASK_TITLES.includes(t.title) &&
        t.status !== "completed" &&
        t.status !== "cancelled"
    )
    for (const t of tasks) {
      await taskService.updateTasks({ id: t.id, status: "cancelled" })
    }
    return new StepResponse({ cancelled_tasks: tasks.length })
  }
)

/**
 * Cancel the partner's active (non-terminal) production runs for this
 * design, plus their open tasks. This makes cancellation the run's own
 * state (single source of truth) rather than a separate flag.
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
        }
      }
    }
    return new StepResponse({ cancelled_runs: ids.length })
  }
)

/**
 * Reset the design's partner_* metadata + set the (legacy) cancel marker.
 * The marker is now only consulted for designs that have no production
 * runs; run-backed designs derive "cancelled" from the cancelled run.
 * Compensation restores the prior metadata.
 */
const markAssignmentCancelledStep = createStep(
  "cpa-mark-cancelled",
  async (input: { design_id: string; partner_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const designService: any = container.resolve(DESIGN_MODULE)
    const { data } = await query.graph({
      entity: "design",
      filters: { id: input.design_id },
      fields: ["id", "metadata"],
    })
    const prevMeta = (data?.[0]?.metadata as Record<string, any>) || {}
    const cleanMeta = { ...prevMeta }
    delete cleanMeta.partner_status
    delete cleanMeta.partner_phase
    delete cleanMeta.partner_started_at
    delete cleanMeta.partner_finished_at
    delete cleanMeta.partner_completed_at
    cleanMeta.partner_assignment_cancelled_at = new Date().toISOString()
    cleanMeta.partner_assignment_cancelled_partner_id = input.partner_id

    await designService.updateDesigns({ id: input.design_id, metadata: cleanMeta })
    return new StepResponse({ ok: true }, { design_id: input.design_id, prevMeta })
  },
  async (comp, { container }) => {
    if (!comp?.design_id) return
    const designService: any = container.resolve(DESIGN_MODULE)
    await designService.updateDesigns({ id: comp.design_id, metadata: comp.prevMeta })
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
    const txn = cancelV1TransactionStep({ design_id: input.design_id })
    const tasks = cancelV1TasksStep({ design_id: input.design_id })
    const runs = cancelPartnerRunsStep({
      design_id: input.design_id,
      partner_id: input.partner_id,
    })
    markAssignmentCancelledStep({
      design_id: input.design_id,
      partner_id: input.partner_id,
    })
    const unlinked = unlinkPartnerStep({
      design_id: input.design_id,
      partner_id: input.partner_id,
      unlink: input.unlink,
    })

    return new WorkflowResponse({
      transaction_id: txn.transaction_id,
      cancelled_tasks: tasks.cancelled_tasks,
      cancelled_runs: runs.cancelled_runs,
      unlinked: unlinked.unlinked,
    })
  }
)
