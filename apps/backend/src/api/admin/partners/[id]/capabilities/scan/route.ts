/**
 * @file POST /admin/partners/:id/capabilities/scan (#2249)
 * @description Read a partner's website and PROPOSE capability samples and
 *   knowledge. Writes a scan row and nothing else — commit is a separate call.
 * @module API/Admin/Partners/Capabilities
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { scanPartnerWebsiteWorkflow } from "../../../../../../workflows/partner/scan-partner-website"
import type { AdminScanPartnerWebsiteReq } from "../validators"

export const POST = async (
  req: MedusaRequest<AdminScanPartnerWebsiteReq>,
  res: MedusaResponse
) => {
  const body = ((req as any).validatedBody || req.body) as AdminScanPartnerWebsiteReq
  const { result } = await scanPartnerWebsiteWorkflow(req.scope).run({
    input: { partner_id: req.params.id, url: body.url },
  })
  return res.status(201).json({ scan: result })
}
