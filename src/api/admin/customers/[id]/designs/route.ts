import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import type { Link } from "@medusajs/framework/link"

type LinkDesignsBody = {
  design_ids: string[]
}

export const POST = async (
  req: MedusaRequest<LinkDesignsBody>,
  res: MedusaResponse
) => {
  const { id: customer_id } = req.params
  const { design_ids } = req.validatedBody as LinkDesignsBody

  const remoteLink = req.scope.resolve<Link>(ContainerRegistrationKeys.LINK)

  for (const design_id of design_ids) {
    await remoteLink.create({
      [DESIGN_MODULE]: { design_id },
      [Modules.CUSTOMER]: { customer_id },
    })
  }

  res.json({ linked: design_ids.length })
}
