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

  const collated = (orders || []).filter(
    (o: any) =>
      o?.metadata?.collated_design_order === true &&
      (o?.production_runs?.length ?? 0) > 0
  )
  collated.sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1))

  const count = collated.length
  const page = collated.slice(offset, offset + limit)

  const designIds = Array.from(
    new Set(
      page.flatMap((o: any) =>
        (o.production_runs || []).map((r: any) => r.design_id).filter(Boolean)
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
    design_count: (o.production_runs || []).length,
    runs: o.production_runs || [],
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
