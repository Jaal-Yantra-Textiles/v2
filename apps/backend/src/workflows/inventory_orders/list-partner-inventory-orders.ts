import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import InventoryOrderPartnerLink from "../../links/partner-inventory-order"
import { applyInventoryOrderListFilters } from "../../api/partners/inventory-orders/list-filters"

// #843 — the partner inventory-orders listing, lifted out of
// `GET /partners/inventory-orders` into a workflow so the admin inspection
// mirror (`GET /admin/partners/:id/inventory-orders`) runs the SAME logic
// rather than re-deriving it. Re-deriving is how two surfaces drift, and the
// mirror is only worth having if it cannot lie.
//
// The route keeps auth (resolve the partner from the bearer) and hands the rest
// here. The admin proxy resolves the partner from `:id` and calls this same
// workflow — that is the entire difference between the two surfaces.

export type ListPartnerInventoryOrdersWorkflowInput = {
  partnerId: string
  q?: string
  status?: string
  offset: number
  limit: number
  /** Forwarded to `query.graph` for translated fields; the route reads it off the request. */
  locale?: string
}

/**
 * The partner-scoped inventory-order set: every order linked to this partner.
 *
 * Pagination is deliberately NOT applied here. `query.graph` cannot filter on
 * the linked module's own columns (`inventory_orders.status`) and the partner
 * route has no free-text index, so status/`q` are matched in-app downstream.
 * Slicing here would cut BEFORE those filters run, returning the wrong page and
 * a per-page (not total) count — the #484 page-vs-set bug.
 */
export const resolvePartnerInventoryOrderRowsStep = createStep(
  "resolve-partner-inventory-order-rows",
  async (input: { partnerId: string; locale?: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph(
      {
        entity: InventoryOrderPartnerLink.entryPoint,
        fields: [
          "inventory_orders.*",
          "inventory_orders.orderlines.*",
          "inventory_orders.stock_locations.*",
          "inventory_orders.tasks.*",
          "partner.*",
        ],
        filters: { partner_id: input.partnerId },
      },
      { locale: input.locale }
    )

    return new StepResponse((data || []) as any[])
  }
)

/**
 * The partner's view of one inventory order — status derived from the
 * `partner_assignment` workflow TASKS, not from metadata (see #778 / the
 * no-critical-data-in-metadata rule).
 */
export const buildPartnerInventoryOrderView = (
  linkData: any,
  partnerId: string
) => {
  const order = linkData.inventory_orders

  const partnerTasks = order.tasks || []
  const workflowTasks = partnerTasks.filter(
    (task: any) => task && task.metadata?.workflow_type === "partner_assignment"
  )

  let partnerStatus = "assigned"
  let partnerStartedAt: string | null = null
  let partnerCompletedAt: string | null = null

  if (workflowTasks.length > 0) {
    const sentTask = workflowTasks.find(
      (task: any) => task.title?.includes("sent") && task.status === "completed"
    )
    const receivedTask = workflowTasks.find(
      (task: any) =>
        task.title?.includes("received") && task.status === "completed"
    )
    const shippedTask = workflowTasks.find(
      (task: any) =>
        task.title?.includes("shipped") && task.status === "completed"
    )

    if (shippedTask) {
      partnerStatus = "completed"
      partnerCompletedAt = shippedTask.updated_at
        ? String(shippedTask.updated_at)
        : null
    } else if (receivedTask) {
      partnerStatus = "in_progress"
      partnerStartedAt = receivedTask.updated_at
        ? String(receivedTask.updated_at)
        : null
    } else if (sentTask) {
      partnerStatus = "assigned"
    }
  }

  return {
    id: order.id,
    status: order.status,
    quantity: order.quantity,
    total_price: order.total_price,
    expected_delivery_date: order.expected_delivery_date,
    order_date: order.order_date,
    is_sample: order.is_sample,
    order_lines_count: order.orderlines?.length || 0,
    stock_location: order.stock_locations?.[0]?.name || "Unknown",
    partner_info: {
      assigned_partner_id: linkData.partner?.id || partnerId,
      partner_status: partnerStatus,
      partner_started_at: partnerStartedAt,
      partner_completed_at: partnerCompletedAt,
      workflow_tasks_count: workflowTasks.length,
    },
    created_at: order.created_at,
    updated_at: order.updated_at,
  }
}

export const listPartnerInventoryOrdersWorkflow = createWorkflow(
  "list-partner-inventory-orders",
  (input: ListPartnerInventoryOrdersWorkflowInput) => {
    const rows = resolvePartnerInventoryOrderRowsStep({
      partnerId: input.partnerId,
      locale: input.locale,
    })

    // status + free-text (`q`) filtering runs AFTER the mapping (so `q` can
    // match the resolved view's fields), THEN paginates — over the full
    // partner-scoped set, so `count` is the total matched and the UI pager is
    // correct. `applyInventoryOrderListFilters` is pure and unit-tested.
    const output = transform({ rows, input }, ({ rows, input }) => {
      const mapped = (rows as any[]).map((row) =>
        buildPartnerInventoryOrderView(row, input.partnerId)
      )

      const { items, count } = applyInventoryOrderListFilters(mapped, {
        q: input.q,
        status: input.status,
        offset: input.offset,
        limit: input.limit,
      })

      return {
        inventory_orders: items,
        count,
        limit: input.limit,
        offset: input.offset,
      }
    })

    return new WorkflowResponse(output)
  }
)

export default listPartnerInventoryOrdersWorkflow
