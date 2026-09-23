/**
 * @file GET /admin/partners/:id/capabilities/scans (#2249)
 * @description A partner's capability scans, newest first, WITHOUT their
 *   proposals — enough to find a scan whose request timed out at the gateway
 *   while the server still stored it, then read it by id.
 * @module API/Admin/Partners/Capabilities
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PARTNER_CAPABILITY_MODULE } from "../../../../../../modules/partner_capability"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_CAPABILITY_MODULE)
  const [scans, count] = await service.listAndCountPartnerCapabilityScans(
    { partner_id: req.params.id },
    { order: { created_at: "DESC" }, take: 50 }
  )
  return res.json({
    scans: (scans ?? []).map((s: any) => ({
      id: s.id,
      kind: s.kind,
      platform: s.platform,
      url: s.url,
      status: s.status,
      created_at: s.created_at,
      committed_at: s.committed_at,
      grouped_by: s.proposal?.grouped_by ?? null,
      sample_count: s.proposal?.samples?.length ?? 0,
      knowledge_count: s.proposal?.knowledge?.length ?? 0,
    })),
    count,
  })
}
