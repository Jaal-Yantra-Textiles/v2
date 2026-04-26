import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../../../../../modules/designs"

type LinkDesignsBody = {
  design_ids: string[]
}

export const POST = async (
  req: MedusaRequest<LinkDesignsBody>,
  res: MedusaResponse
) => {
  const { id: customer_id } = req.params
  const { design_ids } = req.validatedBody as LinkDesignsBody

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

  const links = design_ids.map((design_id) => ({
    [DESIGN_MODULE]: { design_id },
    [Modules.CUSTOMER]: { customer_id },
  }))

  await remoteLink.create(links)

  res.json({ linked: design_ids.length })
}
