import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import designOrderLink from "../../../../../links/design-order-link"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const orderId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data: orderDesignLinks } = await query.graph({
    entity: designOrderLink.entryPoint,
    filters: { order_id: orderId },
    fields: ["design_id"],
  })

  if (!orderDesignLinks?.length) {
    // Backwards-compatible: still return singular `design: null` + new `designs: []`
    res.status(200).json({ design: null, designs: [] })
    return
  }

  const designIds = orderDesignLinks.map((link: any) => link.design_id)

  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: designIds },
    fields: ["id", "name", "status", "description", "thumbnail_url", "estimated_cost"],
  })

  const result = designs || []

  res.status(200).json({
    // Backwards-compatible singular field
    design: result[0] ?? null,
    designs: result,
  })
}
