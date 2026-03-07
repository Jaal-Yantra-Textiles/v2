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
    res.status(200).json({ design: null })
    return
  }

  const designId = orderDesignLinks[0].design_id
  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: designId },
    fields: ["id", "name", "status", "description", "thumbnail_url", "estimated_cost"],
  })

  res.status(200).json({ design: designs?.[0] ?? null })
}
