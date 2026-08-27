import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { PARTNER_WORK_ORDERS_CHANNEL } from "../../../workflows/inventory_orders/dual-write-unified-order"
import { PARTNER_MODULE } from "../../../modules/partner"

/**
 * #826 — list COLLATED design work-orders (the projection orders that hold N
 * design lines). Covers BOTH the commissioning-sourced orders and the
 * no-customer "Send to Production" ones (which have no design-order/cart, so
 * they never appear in the cart-grouped design-orders list). Each row carries
 * its per-design runs so the admin can see/track every design's status; the
 * lifecycle actions live on the canonical /production-runs/:id page.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const scService: any = req.scope.resolve(Modules.SALES_CHANNEL)
  const limit = Number((req.query as any).limit) || 20
  const offset = Number((req.query as any).offset) || 0
  // Filters. Without these the only way to find ONE work-order was to page the
  // whole channel and match by eye — and the route already loads every order in
  // it unbounded, so the caller paid for that either way.
  const idFilter = ((req.query as any).id || "").trim()
  // The COMMISSIONING order this work-order was collated from. The bridge
  // between the two order ids: given a customer order, find its work-order.
  const sourceOrderFilter = ((req.query as any).source_order_id || "").trim()
  const partnerFilter = ((req.query as any).partner_id || "").trim()
  const runStatusFilter = ((req.query as any).run_status || "").trim()
  /**
   * #1574 — cancelled runs are hidden by default.
   *
   * A cancelled run kept rendering as a design line, so an order whose work was
   * called off still read as partly-finished production: `design_count` counted
   * it and the row rendered next to the live ones. What the admin needs to see
   * here is work that is genuinely still in flight.
   *
   * Hidden, not dropped — `include_cancelled=true` brings them back, because
   * "what happened to this order" is a real question and the answer must stay
   * reachable. An explicit `run_status=cancelled` also overrides, since asking
   * for them by name and getting nothing would be absurd.
   */
  const includeCancelled =
    String((req.query as any).include_cancelled || "").trim() === "true" ||
    runStatusFilter === "cancelled"
  const visibleRuns = (runs: any[]) =>
    includeCancelled
      ? runs
      : runs.filter((r: any) => String(r?.status) !== "cancelled")

  const [channel] = await scService.listSalesChannels({
    name: PARTNER_WORK_ORDERS_CHANNEL,
  })
  if (!channel) {
    return res.json({ design_work_orders: [], designs: {}, partners: {}, count: 0, limit, offset })
  }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "status",
      "created_at",
      "currency_code",
      "email",
      "metadata",
      "production_runs.id",
      "production_runs.design_id",
      "production_runs.status",
      "production_runs.partner_id",
      "production_runs.quantity",
      "production_runs.partner_cost_estimate",
      "production_runs.accepted_at",
      "production_runs.started_at",
      "production_runs.finished_at",
      "production_runs.completed_at",
      "unified_order_status.partner_status",
    ],
    filters: { sales_channel_id: channel.id },
  })

  const collated = (orders || []).filter((o: any) => {
    if (o?.metadata?.collated_design_order !== true) return false
    // 🔴 Emptiness is tested on the VISIBLE runs, so an order whose every run
    // was cancelled drops out of the list entirely rather than rendering as a
    // work-order with no designs in it.
    const runs = visibleRuns(o?.production_runs ?? [])
    if (!runs.length) return false
    if (idFilter && o.id !== idFilter) return false
    if (sourceOrderFilter && o?.metadata?.source_order_id !== sourceOrderFilter) {
      return false
    }
    if (partnerFilter && !runs.some((r: any) => r?.partner_id === partnerFilter)) {
      return false
    }
    if (runStatusFilter && !runs.some((r: any) => r?.status === runStatusFilter)) {
      return false
    }
    return true
  })
  collated.sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1))

  const count = collated.length
  const page = collated.slice(offset, offset + limit)

  const designIds = Array.from(
    new Set(
      page.flatMap((o: any) =>
        visibleRuns(o.production_runs || [])
          .map((r: any) => r.design_id)
          .filter(Boolean)
      )
    )
  )
  const partnerIds = Array.from(
    new Set(
      page.flatMap((o: any) =>
        (o.production_runs || []).map((r: any) => r.partner_id).filter(Boolean)
      )
    )
  )

  const designById: Record<string, any> = {}
  if (designIds.length) {
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: designIds },
      fields: [
        "id",
        "name",
        "design_type",
        "status",
        "priority",
        "target_completion_date",
        "estimated_cost",
        "cost_currency",
      ],
    })
    for (const d of designs || []) designById[d.id] = d
  }

  const partnerNameById: Record<string, string> = {}
  if (partnerIds.length) {
    const partnerService: any = req.scope.resolve(PARTNER_MODULE)
    const partners = await partnerService.listPartners({ id: partnerIds })
    for (const p of partners || []) partnerNameById[p.id] = p.name
  }

  const rows = page.map((o: any) => ({
    id: o.id,
    display_id: o.display_id,
    status: o.status,
    created_at: o.created_at,
    currency_code: o.currency_code,
    has_customer: !!o.email,
    partner_status: o.unified_order_status?.partner_status ?? null,
    source_order_id: o.metadata?.source_order_id ?? null,
    // Counts what is rendered. A count that included the hidden rows would
    // say "3 designs" above a list of one.
    design_count: visibleRuns(o.production_runs || []).length,
    runs: visibleRuns(o.production_runs || []),
  }))

  res.json({
    design_work_orders: rows,
    designs: designById,
    partners: partnerNameById,
    count,
    limit,
    offset,
  })
}
