import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import {
  computeTotalsFromLines,
  describeReceiptConflicts,
  missingLineIds,
  receiptConflicts,
  removesEveryLine,
  type ProposedCharge,
  type ProposedLine,
} from "../../modules/inventory_orders/lib/order-changes"
import { notifyPartnerOfChangeDecisionStep } from "./lib/notify-partner-of-change-decision"
import { updateInventoryOrderWorkflow } from "./update-inventory-orders"

/**
 * APPROVE a partner's proposed revision of an inventory order (#1752).
 *
 * The admin route runs this post-ship. It promotes the staged draft into the
 * REAL tables — the line set via the existing `update-inventory-order-workflow`
 * (the same code path as the admin order-lines PUT, so totals, the core mirror
 * and any stock posting are all handled identically), and the `tax` charges as
 * real `inventory_order_charge` rows that raise the payable ceiling. Only then
 * is the change marked approved; a failure anywhere leaves it pending for retry
 * (the engine compensates every completed step).
 */

export type ApproveInventoryOrderChangeInput = {
  orderId: string
  changeId: string
  /** Admin actor id, recorded on the change. */
  decidedBy: string
}

type ApprovalContext = {
  alreadyApproved: boolean
  hasLines: boolean
  lines: ProposedLine[]
  quantity: number
  total_price: number
  charges: ProposedCharge[]
}

/**
 * Load the change, refuse a foreign/rejected one, validate the proposed line
 * ids against THIS order, and derive the totals the approved line set implies.
 */
const loadChangeForApprovalStep = createStep(
  "load-inventory-order-change-for-approval",
  async (input: { orderId: string; changeId: string }, { container }) => {
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    const change = await service.retrieveOrderChange(input.changeId)
    if (!change || change.inventory_orders_id !== input.orderId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory order change ${input.changeId} not found`
      )
    }
    if (change.status === "rejected") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Inventory order change ${input.changeId} was already rejected`
      )
    }

    const order = await service.retrieveInventoryOrder(input.orderId, {
      relations: ["orderlines"],
    })
    const orderLineIds = (order?.orderlines ?? []).map((l: any) => l.id)

    const lines = (Array.isArray(change.proposed_lines)
      ? change.proposed_lines
      : []) as ProposedLine[]
    const missing = missingLineIds(
      lines.map((l) => l.id),
      orderLineIds
    )
    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Order line not found on this order: ${missing.join(", ")}`
      )
    }

    /**
     * 🔴 A proposal must not contradict goods that have already ARRIVED.
     *
     * Staging is locked to Pending/Processing, but approval is deliberately
     * post-ship and `updateInventoryOrderWorkflow` carries no status lock of
     * its own. Since #2118 that matters: receipts are recorded as
     * `line_fulfillments`, and a real receipt ran on prod the same day this
     * shipped.
     *
     * Checked HERE rather than at staging, because the receipts may not exist
     * yet when the partner proposes — the order is still Processing then. The
     * only moment this can be true is at approval.
     *
     * Read from the query graph rather than the service relation: the
     * cumulative quantity lives on the link, and this is the same field the
     * receipt planner reads (`orderlines.line_fulfillments.quantity_delta`),
     * so the two cannot disagree about what "received" means.
     */
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const receivedByLine: Record<string, number> = {}
    try {
      const { data: rows } = await query.graph({
        entity: "inventory_orders",
        fields: [
          "id",
          "orderlines.id",
          "orderlines.line_fulfillments.quantity_delta",
        ],
        filters: { id: input.orderId },
      })
      for (const ol of (rows?.[0]?.orderlines ?? []) as any[]) {
        if (!ol?.id) continue
        receivedByLine[String(ol.id)] = ((ol.line_fulfillments ?? []) as any[]).reduce(
          (sum, f) => sum + (Number(f?.quantity_delta) || 0),
          0
        )
      }
    } catch (e: any) {
      // Refuse rather than approve blind. An unreadable receipt state must not
      // read as "nothing has been received" — that is precisely the reading
      // this guard exists to prevent.
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Could not read what has already been received on order ${input.orderId}, so this change cannot be approved safely: ${e?.message ?? "unknown error"}`
      )
    }

    /**
     * 🔴 Re-checked here, not only at staging (#1752).
     *
     * A change staged when the order had three lines can be approved after an
     * admin has already deleted two of them, and the survivors are then exactly
     * the ones the partner ticked. The staging check was true when it ran and
     * is false by the time it matters, which is the shape of every guard that
     * validates against a snapshot and applies against the present.
     */
    if (removesEveryLine(lines, orderLineIds)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Approving this change would remove every line on order ${input.orderId}, leaving no goods and nothing payable. Emptying an order is a cancellation, not an edit — reject this change, or cancel the order.`
      )
    }

    const conflicts = receiptConflicts(lines, receivedByLine)
    if (conflicts.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `This change contradicts goods already received: ${describeReceiptConflicts(conflicts)}. Raising a quantity is still allowed; removing a received line or reducing it below what arrived is not.`
      )
    }

    const { quantity, total_price } = computeTotalsFromLines(lines)
    const charges = (Array.isArray(change.proposed_charges)
      ? change.proposed_charges
      : []) as ProposedCharge[]

    return new StepResponse(
      {
        alreadyApproved: change.status === "approved",
        hasLines: lines.length > 0,
        lines,
        quantity,
        total_price,
        charges,
      } satisfies ApprovalContext,
      null
    )
  }
)

/** Promote the proposed `tax` charges into real order charges. */
const createProposedChargesStep = createStep(
  "create-proposed-inventory-order-charges",
  async (
    input: { orderId: string; charges: ProposedCharge[] },
    { container }
  ) => {
    const charges = (Array.isArray(input.charges) ? input.charges : []).filter(
      (c) => c && c.type === "tax" && Number.isFinite(Number(c.amount)) && Number(c.amount) > 0
    )
    if (charges.length === 0) {
      return new StepResponse({ created: 0 }, null)
    }

    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    const createdIds: string[] = []
    for (const c of charges) {
      const created = await service.createOrderCharges({
        type: "tax",
        amount: Number(c.amount),
        note: c.note ?? null,
        inventory_orders_id: input.orderId,
      })
      const rows = Array.isArray(created) ? created : [created]
      for (const r of rows) createdIds.push(r.id)
    }
    return new StepResponse({ created: createdIds.length }, { ids: createdIds })
  },
  async (comp: { ids: string[] } | null, { container }) => {
    if (!comp?.ids?.length) return
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    for (const id of comp.ids) {
      try {
        await service.softDeleteOrderCharges(id)
      } catch {
        /* row may already be gone; keep cleaning the rest */
      }
    }
  }
)

/** Flip the change to approved. */
const markApprovedStep = createStep(
  "mark-inventory-order-change-approved",
  async (
    input: { changeId: string; decidedBy: string },
    { container }
  ) => {
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    const prior = await service.retrieveOrderChange(input.changeId)
    await service.updateOrderChanges({
      selector: { id: input.changeId },
      data: {
        status: "approved",
        decided_by: input.decidedBy,
        decided_at: new Date().toISOString(),
      },
    })
    const updated = await service.retrieveOrderChange(input.changeId)
    return new StepResponse(updated, {
      id: input.changeId,
      priorStatus: prior?.status ?? "pending",
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
        decided_by: comp.priorDecidedBy,
        decided_at: comp.priorDecidedAt,
      },
    })
  }
)

export const approveInventoryOrderChangeWorkflow = createWorkflow(
  "approve-inventory-order-change",
  (input: ApproveInventoryOrderChangeInput) => {
    const ctx = loadChangeForApprovalStep({
      orderId: input.orderId,
      changeId: input.changeId,
    })

    const alreadyApproved = transform({ ctx }, ({ ctx }) =>
      Boolean((ctx as any)?.alreadyApproved)
    )

    // Promote the line set through the existing line-update workflow, only when
    // there are lines AND the change is still pending.
    const shouldApplyLines = transform({ ctx }, ({ ctx }) =>
      Boolean((ctx as any)?.hasLines && !(ctx as any)?.alreadyApproved)
    )
    when(shouldApplyLines, (b) => Boolean(b)).then(() => {
      updateInventoryOrderWorkflow.runAsStep({
        input: transform({ input, ctx }, ({ input, ctx }) => ({
          id: input.orderId,
          data: {
            quantity: (ctx as any).quantity,
            total_price: (ctx as any).total_price,
          },
          order_lines: (ctx as any).lines,
        })),
      })
    })

    // Charges + the approved stamp run only when the change is still pending.
    const shouldApply = transform({ ctx }, ({ ctx }) =>
      Boolean(!(ctx as any)?.alreadyApproved)
    )
    when(shouldApply, (b) => Boolean(b)).then(() => {
      createProposedChargesStep({
        orderId: input.orderId,
        charges: transform({ ctx }, ({ ctx }) => (ctx as any).charges),
      })
      markApprovedStep({
        changeId: input.changeId,
        decidedBy: input.decidedBy,
      })
      /**
       * Tell the partner. Last, and only inside this branch: an approval that
       * was already recorded must not notify twice, and nothing should be
       * announced before it is true.
       */
      notifyPartnerOfChangeDecisionStep({
        orderId: input.orderId,
        changeId: input.changeId,
        decision: "approved",
      })
    })

    return new WorkflowResponse({
      changeId: input.changeId,
      alreadyApproved,
    })
  }
)

export default approveInventoryOrderChangeWorkflow