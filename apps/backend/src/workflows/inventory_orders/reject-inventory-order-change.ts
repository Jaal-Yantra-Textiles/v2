import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { notifyPartnerOfChangeDecisionStep } from "./lib/notify-partner-of-change-decision"

/**
 * REJECT a partner's proposed revision of an inventory order (#1752).
 *
 * Records the refusal (with a reason the partner can be shown) and applies
 * nothing. The pending proposal is closed, so the partner may stage a fresh one.
 */

export type RejectInventoryOrderChangeInput = {
  orderId: string
  changeId: string
  decidedBy: string
  reason?: string | null
}

const loadChangeForRejectStep = createStep(
  "load-inventory-order-change-for-reject",
  async (input: { orderId: string; changeId: string }, { container }) => {
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    const change = await service.retrieveOrderChange(input.changeId)
    if (!change || change.inventory_orders_id !== input.orderId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory order change ${input.changeId} not found`
      )
    }
    if (change.status === "approved") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Inventory order change ${input.changeId} was already approved and cannot be rejected`
      )
    }
    return new StepResponse({ change }, null)
  }
)

const markRejectedStep = createStep(
  "mark-inventory-order-change-rejected",
  async (
    input: { changeId: string; decidedBy: string; reason: string | null },
    { container }
  ) => {
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    const prior = await service.retrieveOrderChange(input.changeId)
    await service.updateOrderChanges({
      selector: { id: input.changeId },
      data: {
        status: "rejected",
        rejection_reason: input.reason,
        decided_by: input.decidedBy,
        decided_at: new Date().toISOString(),
      },
    })
    const updated = await service.retrieveOrderChange(input.changeId)
    return new StepResponse(updated, {
      id: input.changeId,
      priorStatus: prior?.status ?? "pending",
      priorReason: prior?.rejection_reason ?? null,
      priorDecidedBy: prior?.decided_by ?? null,
      priorDecidedAt: prior?.decided_at ?? null,
    })
  },
  async (comp: any, { container }) => {
    if (!comp?.id) return
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    await service.updateOrderChanges({
      selector: { id: comp.id },
      data: {
        status: comp.priorStatus,
        rejection_reason: comp.priorReason,
        decided_by: comp.priorDecidedBy,
        decided_at: comp.priorDecidedAt,
      },
    })
  }
)

export const rejectInventoryOrderChangeWorkflow = createWorkflow(
  "reject-inventory-order-change",
  (input: RejectInventoryOrderChangeInput) => {
    loadChangeForRejectStep({ orderId: input.orderId, changeId: input.changeId })
    const updated = markRejectedStep({
      changeId: input.changeId,
      decidedBy: input.decidedBy,
      reason: input.reason ?? null,
    })
    /**
     * The half that needed this most: a rejection carries a REASON an operator
     * typed for the partner, and until now there was no path by which they
     * would ever read it.
     */
    notifyPartnerOfChangeDecisionStep({
      orderId: input.orderId,
      changeId: input.changeId,
      decision: "rejected",
      reason: input.reason ?? null,
    })
    return new WorkflowResponse({ change: updated })
  }
)

export default rejectInventoryOrderChangeWorkflow