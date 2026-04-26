import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import type DesignService from "../../../../../modules/designs/service"

/**
 * GET /admin/designs/:id/used-in
 * List all bundle designs that include this design as a component.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: componentDesignId } = req.params
  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService

  const usages = await designService.listDesignComponents(
    { component_design_id: componentDesignId },
    { relations: ["parent_design"] }
  )

  res.json({ used_in: usages, count: usages.length })
}
