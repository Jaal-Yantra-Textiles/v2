import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import designOrderLink from "../../../../../../links/design-order-link"

/**
 * Returns designs that are linked to orders belonging to this customer.
 * These are designs that were previously linked to the customer and then
 * converted into a draft order (at which point they were delinked).
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  // Find all orders for this customer
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { customer_id: customerId },
    fields: ["id"],
  })

  if (!orders?.length) {
    res.status(200).json({ designs: [] })
    return
  }

  const orderIds = orders.map((o: any) => o.id)

  // Find all design-order links for those orders
  const { data: designOrderLinks } = await query.graph({
    entity: designOrderLink.entryPoint,
    filters: { order_id: orderIds },
    fields: ["design_id", "order_id"],
  })

  if (!designOrderLinks?.length) {
    res.status(200).json({ designs: [] })
    return
  }

  const designIds = [...new Set(designOrderLinks.map((l: any) => l.design_id))]

  // Build order_id lookup per design
  const designOrderMap: Record<string, string[]> = {}
  for (const link of designOrderLinks) {
    if (!designOrderMap[link.design_id]) {
      designOrderMap[link.design_id] = []
    }
    designOrderMap[link.design_id].push(link.order_id)
  }

  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: designIds },
    fields: [
      "id",
      "name",
      "description",
      "status",
      "design_type",
      "thumbnail_url",
      "estimated_cost",
    ],
  })

  const result = (designs || []).map((d: any) => ({
    ...d,
    order_ids: designOrderMap[d.id] || [],
  }))

  res.status(200).json({ designs: result })
}
