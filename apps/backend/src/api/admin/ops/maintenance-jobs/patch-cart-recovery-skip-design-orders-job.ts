import { MedusaError } from "@medusajs/framework/utils"

import { VISUAL_FLOWS_MODULE } from "../../../../modules/visual_flows"
import {
  CART_RECOVERY_FLOW_NAME,
  CLASSIFY_OPERATION_KEY,
  ClassifyGate,
  patchCanvasClassify,
  patchClassifyCode,
} from "./patch-cart-recovery-cancelled-gate-job"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Design orders have their own follow-up (`design-order-followup`: a reminder,
 * a last call, then closing). Without this gate they ALSO get the storefront's
 * "You left something beautiful behind", twice — wrong words for a bespoke
 * order, and a second voice chasing the same buyer.
 *
 * Same mechanics as `patch-cart-recovery-cancelled-gate`: the live gate is
 * sandboxed code on a database row AND on the canvas node (the canvas copy is
 * what runs), so both are patched in place. Idempotent; refuses on an
 * unexpected body.
 */
export const DESIGN_ORDER_SKIP_GATE: ClassifyGate = {
  block: `  // Design orders have their own follow-up (design-order-followup job):
  // a reminder, a last call, then the order is closed. Never send them the
  // storefront's abandoned-cart mail as well.
  if (md.source === "design-order") {
    counts.design_order = (counts.design_order || 0) + 1
    continue
  }
`,
  isPatched: (code) => /md\.source === "design-order"/.test(String(code ?? "")),
}

const JOB_ID = "patch-cart-recovery-skip-design-orders"

export const patchCartRecoverySkipDesignOrdersJob: MaintenanceJob = {
  id: JOB_ID,
  label: "Stop cart recovery emailing design orders",
  description:
    "Insert a `metadata.source === \"design-order\"` skip into the cart-recovery flow's `classify` node (operation row AND canvas copy, which is what runs), so design orders get only their own follow-up (design-order-followup) and not the storefront's abandoned-cart email. Idempotent; refuses if the expected `converted_order_id` block is absent. Preview shows the exact before/after.",
  params: [],
  run: async (container, { dry_run }): Promise<MaintenanceJobResult> => {
    const service: any = container.resolve(VISUAL_FLOWS_MODULE)
    const flows = (await service.listVisualFlows({ name: CART_RECOVERY_FLOW_NAME })) as any[]
    if (flows?.length !== 1) {
      throw new MedusaError(
        flows?.length ? MedusaError.Types.INVALID_DATA : MedusaError.Types.NOT_FOUND,
        flows?.length
          ? `${flows.length} flows are named "${CART_RECOVERY_FLOW_NAME}"; refusing to guess.`
          : `No visual flow named "${CART_RECOVERY_FLOW_NAME}"`
      )
    }
    const flow = flows[0]
    const [op] = (await service.listVisualFlowOperations({
      flow_id: flow.id,
      operation_key: CLASSIFY_OPERATION_KEY,
    })) as any[]
    if (!op) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Flow has no "${CLASSIFY_OPERATION_KEY}" operation`)
    }

    const changes: MaintenanceChange[] = []
    const options = (op.options ?? {}) as Record<string, unknown>
    const rowOutcome = patchClassifyCode(options.code, DESIGN_ORDER_SKIP_GATE)
    if (rowOutcome.ok) {
      changes.push({
        entity: "visual_flow_operation",
        id: op.id,
        field: "options.code",
        before: String(options.code ?? ""),
        after: rowOutcome.code,
        note: `Flow "${CART_RECOVERY_FLOW_NAME}" (${flow.id}): skip design orders.`,
      })
      if (!dry_run) {
        await service.updateVisualFlowOperations({ id: op.id, options: { ...options, code: rowOutcome.code } })
      }
    }

    const canvas = patchCanvasClassify(flow.canvas_state, DESIGN_ORDER_SKIP_GATE)
    if (canvas.ok) {
      changes.push({
        entity: "visual_flow",
        id: flow.id,
        field: `canvas_state.nodes[${canvas.node_id}].data.options.code`,
        before: canvas.before,
        after: canvas.after,
        note: "The canvas copy of the classify node is what the executor runs.",
      })
      if (!dry_run) await service.updateVisualFlows({ id: flow.id, canvas_state: canvas.canvas_state })
    }

    const describe = (r: { ok: boolean; reason?: string }) =>
      r.ok ? (dry_run ? "would patch" : "patched") : r.reason === "already_patched" ? "already patched" : `REFUSED (${r.reason})`
    return {
      job_id: JOB_ID,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: `Operation row: ${describe(rowOutcome as any)}. Canvas copy: ${describe(canvas as any)}.`,
      changes,
    }
  },
}
