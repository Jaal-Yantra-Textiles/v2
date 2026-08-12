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
import { resolveDesignThumbnail } from "../../lib/design-thumbnail"

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
  // status / q / date / region passthrough — folded into every kind's filter
  // unchanged (the route's pure helper decides which are kind-safe). #486.
  baseFilters?: Record<string, any>
  // Remote-query sort, e.g. `{ created_at: "DESC" }` — mirrors admin's
  // `queryConfig.pagination.order`. Defaults to newest-first at the route. #486.
  order?: Record<string, "ASC" | "DESC">
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

// A design work-order row in the partner's table is otherwise all numbers and
// badges — nothing on it says WHICH garment it is. This attaches, per order, a
// small `designs` summary (id, name, thumbnail) so the table can show the
// picture the partner recognises the job by.
//
// Two shapes have to be covered: a legacy single-design order links exactly one
// production run, while a COLLATED order (#826) carries one design per line item
// on `items.metadata.design_id`. We union both sources rather than pick one.
//
// Additive: it only ever ADDS `designs` to rows that resolve to a design, so
// retail/inventory rows and the admin read-proxy (#843) are untouched.
export const attachOrderDesignSummariesStep = createStep(
  "attach-order-design-summaries",
  async (input: { orders: any[] }, { container }) => {
    const orders = Array.isArray(input.orders) ? input.orders : []
    if (!orders.length) {
      return new StepResponse(orders)
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const orderIds = orders.map((o) => o?.id).filter(Boolean)
    if (!orderIds.length) {
      return new StepResponse(orders)
    }

    // The reverse execution accessor resolves to an object for a 1:1 link and
    // an array when several runs hang off one order — tolerate both.
    const asArray = (rel: any): any[] =>
      Array.isArray(rel) ? rel : rel ? [rel] : []

    let rows: any[] = []
    try {
      const { data } = await query.graph({
        entity: "orders",
        fields: [
          "id",
          "production_runs.design_id",
          "items.metadata",
        ],
        filters: { id: orderIds },
      })
      rows = data || []
    } catch {
      // Non-fatal: the table renders without pictures rather than 500-ing.
      return new StepResponse(orders)
    }

    const designIdsByOrder = new Map<string, string[]>()
    const allDesignIds = new Set<string>()
    for (const row of rows) {
      const ids = new Set<string>()
      for (const run of asArray(row?.production_runs)) {
        if (run?.design_id) {
          ids.add(String(run.design_id))
        }
      }
      for (const item of asArray(row?.items)) {
        const designId = item?.metadata?.design_id
        if (designId) {
          ids.add(String(designId))
        }
      }
      if (ids.size) {
        designIdsByOrder.set(String(row.id), [...ids])
        ids.forEach((id) => allDesignIds.add(id))
      }
    }

    if (!allDesignIds.size) {
      return new StepResponse(orders)
    }

    let designs: any[] = []
    try {
      const { data } = await query.graph({
        entity: "design",
        fields: ["id", "name", "media_files", "moodboard", "metadata"],
        filters: { id: [...allDesignIds] },
      })
      designs = data || []
    } catch {
      return new StepResponse(orders)
    }

    const byId = new Map<string, any>(
      designs.filter((d) => d?.id).map((d) => [String(d.id), d])
    )

    const enriched = orders.map((order) => {
      const ids = designIdsByOrder.get(String(order?.id))
      if (!ids?.length) {
        return order
      }
      const summaries = ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((design) => ({
          id: String(design.id),
          name: design.name ?? null,
          // `allowDataUrl` stays off: a base64-inlined moodboard image would
          // be megabytes of JSON per row on a list endpoint.
          thumbnail: resolveDesignThumbnail(design),
        }))
      return summaries.length ? { ...order, designs: summaries } : order
    })

    return new StepResponse(enriched)
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
        // #486: sort is a sibling of `filters` in remote-query variables, exactly
        // as admin's route spreads `queryConfig.pagination` (skip/take/order).
        ...(input.order ? { order: input.order } : {}),
      },
    }))

    const listed = when(
      "partner-orders-not-empty",
      plan,
      (p) => !p.shortCircuit
    ).then(() => getOrdersListWorkflow.runAsStep({ input: listInput }))

    const page = transform({ listed }, ({ listed }) => {
      const result = listed as any
      const orders = Array.isArray(result) ? result : result?.rows ?? []
      const count = Array.isArray(result)
        ? result.length
        : result?.metadata?.count ?? orders.length
      return { orders, count }
    })

    // Design pictures for the rows that have one. Runs over the page only
    // (≤ `take` orders), and no-ops for retail/inventory pages.
    const withDesigns = attachOrderDesignSummariesStep({ orders: page.orders })

    const output = transform(
      { page, withDesigns, input },
      ({ page, withDesigns, input }) => ({
        orders: withDesigns,
        count: page.count,
        offset: input.skip,
        limit: input.take,
      })
    )

    return new WorkflowResponse(output)
  }
)
