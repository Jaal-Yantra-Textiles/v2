/**
 * @file POST /admin/partners/:id/capabilities/scans/:scanId/commit (#2249)
 * @description File chosen proposals from a stored scan into the capability
 *   library, copying their photos into media. Selects by key only; omit both
 *   key lists to commit everything the scan proposed.
 * @module API/Admin/Partners/Capabilities
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { commitPartnerCapabilityScanWorkflow } from "../../../../../../../../workflows/partner/commit-partner-capability-scan"
import type { AdminCommitPartnerCapabilityScanReq } from "../../../validators"

export const POST = async (
  req: MedusaRequest<AdminCommitPartnerCapabilityScanReq>,
  res: MedusaResponse
) => {
  const body = ((req as any).validatedBody || req.body || {}) as AdminCommitPartnerCapabilityScanReq
  const { result } = await commitPartnerCapabilityScanWorkflow(req.scope).run({
    input: {
      partner_id: req.params.id,
      scan_id: req.params.scanId,
      sample_keys: body.sample_keys,
      knowledge_keys: body.knowledge_keys,
    },
  })
  return res.json(result)
}
