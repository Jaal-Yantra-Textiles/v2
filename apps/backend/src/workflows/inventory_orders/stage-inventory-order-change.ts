import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import {
  missingLineIds,
  ORDER_EDITABLE_STATUSES,
  type ProposedCharge,
  type ProposedLine,
} from "../../modules/inventory_orders/lib/order-changes"

/**
 * Stage a partner's PROPOSED revision of an inventory order (#1752).
 *
 * The partner route runs this instead of writing the change row itself. It
 * validates BOTH ends (the order belongs to the caller, the line ids are the
 * order's own) and writes the proposal to the single pending
 * `inventory_order_change` row — never to the real line/charge tables. An admin
 * approval (approve-inventory-order-change) promotes it.
 */

export type StageInventoryOrderChangeInput = {
  orderId: string
  /** The acting partner id — validated against the order's linked partner. */
  partnerId: string
  /** When present, REPLACES `proposed_lines` with this full desired set. */
  lines?: ProposedLine[]
  /** When present, APPENDS these `tax` charges to `proposed_charges`. */
  charges?: ProposedCharge[]
}

type StageContext = {
  orderId: string
  orderLineIds: string[]
  change: any
  created: boolean
}

/** Validate ownership/editable/line-ids, then get-or-create the open change. */
const ensureOpenChangeStep = createStep(
  "ensure-open-inventory-order-change",
  async (
    input: { orderId: string; partnerId: string; lineIds: string[] },
    { container }
  ) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "inventory_orders",
      fields: ["id", "status", "partner.id", "orderlines.id"],
      filters: { id: input.orderId },
    })
    const order = data?.[0]

    // NOT_FOUND (not NOT_ALLOWED) on ownership, matching the partner surface's
    // existing rule: a partner must not learn another tenant's order exists.
    if (!order || order.partner?.id !== input.partnerId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory order ${input.orderId} not found`
      )
    }

    if (!ORDER_EDITABLE_STATUSES.has(String(order.status))) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Inventory order ${input.orderId} can no longer be edited (status ${order.status})`
      )
    }

    const currentIds = (order.orderlines ?? []).map((l: any) => l.id)
    const missing = missingLineIds(input.lineIds, currentIds)
    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Order line not found on this order: ${missing.join(", ")}`
      )
    }

    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    const open = (await service.listOrderChanges({
      inventory_orders_id: input.orderId,
      status: "pending",
    })) as any[]

    if (open?.length) {
      return new StepResponse(
        { orderId: input.orderId, orderLineIds: currentIds, change: open[0], created: false },
        null
      )
    }

    const created = await service.createOrderChanges({
      inventory_orders_id: input.orderId,
      status: "pending",
      proposed_lines: [],
      proposed_charges: [],
      submitted_by: input.partnerId,
      submitted_at: new Date().toISOString(),
    })
    const change = Array.isArray(created) ? created[0] : created
    return new StepResponse(
      { orderId: input.orderId, orderLineIds: currentIds, change, created: true },
      { id: change.id }
    )
  },
  // Compensation: remove the change we created (nothing to do for an existing one).
  async (comp: { id: string } | null, { container }) => {
    if (!comp?.id) return
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    await service.softDeleteOrderChanges(comp.id)
  }
)

/** Write the staged lines (replace) / charges (append) onto the open change. */
const writeStageStep = createStep(
  "write-inventory-order-change-stage",
  async (
    input: {
      ctx: StageContext
      lines?: ProposedLine[]
      charges?: ProposedCharge[]
    },
    { container }
  ) => {
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    const change = input.ctx.change

    const data: Record<string, any> = { submitted_at: new Date().toISOString() }
    if (input.lines) {
      data.proposed_lines = input.lines
    }
    if (input.charges) {
      const current = Array.isArray(change.proposed_charges)
        ? change.proposed_charges
        : []
      data.proposed_charges = [...current, ...input.charges]
    }

    const prior = {
      proposed_lines: change.proposed_lines,
      proposed_charges: change.proposed_charges,
    }

    await service.updateOrderChanges({ selector: { id: change.id }, data })
    const updated = await service.retrieveOrderChange(change.id)
    return new StepResponse(updated, { id: change.id, prior })
  },
  // Compensation: restore the prior proposed_lines/charges.
  async (
    comp: { id: string; prior: { proposed_lines: any; proposed_charges: any } } | null,
    { container }
  ) => {
    if (!comp?.id) return
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    await service.updateOrderChanges({
      selector: { id: comp.id },
      data: {
        proposed_lines: comp.prior.proposed_lines,
        proposed_charges: comp.prior.proposed_charges,
      },
    })
  }
)

export const stageInventoryOrderChangeWorkflow = createWorkflow(
  "stage-inventory-order-change",
  (input: StageInventoryOrderChangeInput) => {
    const lineIds = transform({ input }, ({ input }) =>
      (input.lines ?? []).map((l) => l.id)
    )
    const ctx = ensureOpenChangeStep({
      orderId: input.orderId,
      partnerId: input.partnerId,
      lineIds: lineIds as unknown as string[],
    })
    const updated = writeStageStep({
      ctx: ctx as any,
      lines: input.lines,
      charges: input.charges,
    })
    return new WorkflowResponse({ change: updated })
  }
)

export default stageInventoryOrderChangeWorkflow