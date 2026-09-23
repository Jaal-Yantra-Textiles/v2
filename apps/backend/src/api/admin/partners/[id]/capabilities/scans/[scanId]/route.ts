/**
 * @file GET /admin/partners/:id/capabilities/scans/:scanId (#2249)
 * @description One stored capability scan (website or records) and what it proposed, with which
 *   proposal keys are already committed.
 * @module API/Admin/Partners/Capabilities
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_CAPABILITY_MODULE } from "../../../../../../../modules/partner_capability"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_CAPABILITY_MODULE)
  const [scan] = await service.listPartnerCapabilityScans({ id: req.params.scanId })
  if (!scan || scan.partner_id !== req.params.id) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Capability scan not found for this partner")
  }
  return res.json({ scan })
}
