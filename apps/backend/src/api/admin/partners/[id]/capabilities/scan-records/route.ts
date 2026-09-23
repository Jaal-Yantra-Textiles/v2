/**
 * @file POST /admin/partners/:id/capabilities/scan-records (#2249)
 * @description Propose capability samples from OUR records of the partner —
 *   completed runs, cloth they supplied, products they list with us. Writes a
 *   scan row and nothing else; commit is the shared scans/:scanId/commit.
 * @module API/Admin/Partners/Capabilities
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { scanPartnerRecordsWorkflow } from "../../../../../../workflows/partner/scan-partner-records"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await scanPartnerRecordsWorkflow(req.scope).run({
    input: { partner_id: req.params.id },
  })
  return res.status(201).json({ scan: result })
}
