/**
 * GET /admin/mcp/stats — high-level platform snapshot for the Admin MCP's
 * `get_admin_stats` grounding tool.
 *
 * Returns entity counts (orders, products, customers, partners, designs,
 * production runs, stores) so the assistant can orient before answering
 * operational questions. Each count is resolved independently and tolerates a
 * failure (unknown entity, module not loaded) by returning null for that key —
 * a partial snapshot is more useful to the agent than a 500.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { workOrderIdsInCore } from "../../../../lib/work-orders/admin-order-reads"

/**
 * query.graph entity names to count, keyed by the label surfaced to the model.
 *
 * #2264 S2c — `orders` is NOT here: a plain count of `order` counted every
 * work-order mirror as a sale (prod 2026-09-25: 7 retail orders among 100+
 * rows). It is counted below as retail only, beside `work_orders`.
 */
const COUNTS: Record<string, string> = {
  work_orders: "work_order",
  products: "product",
  customers: "customer",
  partners: "partner",
  designs: "design",
  production_runs: "production_run",
  stores: "store",
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const retailOrders = async (): Promise<readonly [string, number | null]> => {
    try {
      const workOrderIds = await workOrderIdsInCore(req.scope)
      const { metadata } = await query.graph({
        entity: "order",
        fields: ["id"],
        filters: {
          is_draft_order: false,
          ...(workOrderIds.length ? { id: { $nin: workOrderIds } } : {}),
        },
        pagination: { take: 1, skip: 0 },
      })
      return ["orders", (metadata as any)?.count ?? null] as const
    } catch {
      return ["orders", null] as const
    }
  }

  const entries = await Promise.all([
    retailOrders(),
    ...Object.entries(COUNTS).map(async ([label, entity]) => {
      try {
        const { metadata } = await query.graph({
          entity,
          fields: ["id"],
          pagination: { take: 1, skip: 0 },
        })
        return [label, (metadata as any)?.count ?? null] as const
      } catch {
        // Unknown entity name or module not registered — omit gracefully.
        return [label, null] as const
      }
    }),
  ])

  res.json({ stats: Object.fromEntries(entries) })
}
