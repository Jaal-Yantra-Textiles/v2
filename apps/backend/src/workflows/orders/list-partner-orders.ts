import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows"
import partnerOrderLink from "../../links/partner-order"

// Chunk 5 (T3.4, #342): the kind-aware partner orders listing, lifted out of the
// route handler into a workflow so the scoping/discrimination logic is reusable
// and unit-addressable. The route stays thin: it does auth (resolve the partner
// + their sales channel from the request) and hands the rest here.
//
// The unified `order` table holds three kinds, told apart by which execution
// link is present (D5): design (→ production_run), inventory (→ inventory_order),
// retail (neither). The partner side scopes work-orders through the D3
// `partner ↔ order` link — sales-channel scoping is wrong for work, since a
// partner can serve another partner's store — while retail stays
// sales-channel-scoped.

export type PartnerOrderKind = "retail" | "design" | "inventory" | "all"

export type ListPartnerOrdersWorkflowInput = {
  partnerId?: string | null
  salesChannelId?: string | null
  kind: PartnerOrderKind
  fields: string[]
  // status / q passthrough — folded into every kind's filter unchanged.
  baseFilters?: Record<string, any>
  skip: number
  take: number
}

// Resolve THIS partner's work-order order-ids, bucketed by kind, via the D3
// `partner ↔ order` link + the reverse execution link (D5). Two single-hop
// `query.graph` reads on confirmed link directions (partner→orders, then
// order→production_runs/inventory_orders) — never a fragile two-hop selection.
export const resolvePartnerWorkOrderIdsStep = createStep(
  "resolve-partner-work-order-ids",
  async (input: { partnerId?: string | null }, { container }) => {
    const { partnerId } = input
    if (!partnerId) {
      return new StepResponse({ design: [] as string[], inventory: [] as string[] })
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    // Read the D3 partner↔order link table directly (by entryPoint) rather than
    // via a `partner.orders` graph accessor — the link row is the source of
    // truth and the accessor pluralisation isn't guaranteed.
    const { data: linkRows } = await query.graph({
      entity: partnerOrderLink.entryPoint,
      fields: ["order_id"],
      filters: { partner_id: partnerId },
    })
    const orderIds: string[] = Array.from(
      new Set(
        (linkRows ?? []).map((r: any) => r?.order_id).filter(Boolean)
      )
    )

    if (!orderIds.length) {
      return new StepResponse({ design: [] as string[], inventory: [] as string[] })
    }

    // Reverse, PLURAL accessor — see ORDERS_UNIFICATION_342.md "LINK NAMING FINDING".
    const { data: orders } = await query.graph({
      entity: "orders",
      fields: ["id", "production_runs.id", "inventory_orders.id"],
      filters: { id: orderIds },
    })

    // The order→execution links are 1:1, so query.graph resolves the reverse
    // accessor to a single OBJECT (`{ id }`), not an array — test for a linked
    // id, tolerating either shape.
    const linked = (rel: any): boolean =>
      Array.isArray(rel) ? rel.length > 0 : Boolean(rel?.id)

    const design: string[] = []
    const inventory: string[] = []
    for (const o of orders ?? []) {
      if (linked(o?.production_runs)) {
        design.push(o.id)
      } else if (linked(o?.inventory_orders)) {
        inventory.push(o.id)
      }
    }
    return new StepResponse({ design, inventory })
  }
)

export const listPartnerOrdersWorkflow = createWorkflow(
  "list-partner-orders",
  (input: ListPartnerOrdersWorkflowInput) => {
    const workOrderIds = resolvePartnerWorkOrderIdsStep({
      partnerId: input.partnerId,
    })

    // Translate kind → the filter handed to the SAME built-in orders workflow.
    // `shortCircuit` covers the cases that resolve to an empty list without a
    // query (no partner, retail without a channel, a work-order kind the partner
    // has none of) — so we never issue an `id: { $in: [] }`.
    const plan = transform(
      { input, workOrderIds },
      ({ input, workOrderIds }) => {
        const { kind, salesChannelId, partnerId } = input
        const filters: Record<string, any> = { ...(input.baseFilters ?? {}) }
        let shortCircuit = false

        if (!partnerId) {
          shortCircuit = true
        } else if (kind === "retail") {
          // Work-orders live in the internal PARTNER_WORK_ORDERS_CHANNEL, so a
          // sales-channel scope already excludes them — no anti-join needed.
          if (!salesChannelId) {
            shortCircuit = true
          } else {
            filters.sales_channel_id = [salesChannelId]
          }
        } else if (kind === "design" || kind === "inventory") {
          const ids = workOrderIds[kind]
          if (!ids.length) {
            shortCircuit = true
          } else {
            filters.id = { $in: ids }
          }
        } else {
          // all: retail (channel) ∪ this partner's work-orders (D3 link).
          const workIds = [...workOrderIds.design, ...workOrderIds.inventory]
          const or: Record<string, any>[] = []
          if (salesChannelId) {
            or.push({ sales_channel_id: [salesChannelId] })
          }
          if (workIds.length) {
            or.push({ id: { $in: workIds } })
          }
          if (!or.length) {
            shortCircuit = true
          } else {
            filters.$or = or
          }
        }

        return { filters, shortCircuit }
      }
    )

    const listInput = transform({ plan, input }, ({ plan, input }) => ({
      fields: input.fields,
      variables: {
        filters: plan.filters,
        skip: input.skip,
        take: input.take,
      },
    }))

    const listed = when(
      "partner-orders-not-empty",
      plan,
      (p) => !p.shortCircuit
    ).then(() => getOrdersListWorkflow.runAsStep({ input: listInput }))

    const output = transform({ listed, input }, ({ listed, input }) => {
      const result = listed as any
      const orders = Array.isArray(result)
        ? result
        : result?.rows ?? []
      const count = Array.isArray(result)
        ? result.length
        : result?.metadata?.count ?? orders.length
      return {
        orders,
        count,
        offset: input.skip,
        limit: input.take,
      }
    })

    return new WorkflowResponse(output)
  }
)
