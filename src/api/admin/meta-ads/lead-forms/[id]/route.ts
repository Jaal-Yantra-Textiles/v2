import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/lead-forms/:id
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
  const leadForm = await socials.retrieveLeadForm(req.params.id)
  res.json({ leadForm })
}

/**
 * PATCH /admin/meta-ads/lead-forms/:id
 */
export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
  const body = req.body as Record<string, any>
  const leadForm = await socials.updateLeadForms({ id: req.params.id }, body)
  res.json({ leadForm })
}
