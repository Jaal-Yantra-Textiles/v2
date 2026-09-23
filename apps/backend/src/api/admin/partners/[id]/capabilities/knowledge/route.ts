/**
 * @file POST /admin/partners/:id/capabilities/knowledge (#2249)
 * @description Append one learned fact to a partner's capability record —
 *   about one sample, or partner-wide. Never edits an earlier fact.
 * @module API/Admin/Partners/Capabilities
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { addPartnerCapabilityKnowledgeWorkflow } from "../../../../../../workflows/partner/add-partner-capability-knowledge"
import type { AdminAddPartnerCapabilityKnowledgeReq } from "../validators"

export const POST = async (
  req: MedusaRequest<AdminAddPartnerCapabilityKnowledgeReq>,
  res: MedusaResponse
) => {
  const body = ((req as any).validatedBody || req.body) as AdminAddPartnerCapabilityKnowledgeReq
  const { result } = await addPartnerCapabilityKnowledgeWorkflow(req.scope).run({
    input: {
      partner_id: req.params.id,
      fact: body.fact,
      sample_id: body.sample_id ?? null,
      source_url: body.source_url ?? null,
      observed_at: body.observed_at ?? null,
    },
  })
  return res.status(201).json({
    knowledge: result.knowledge,
    observed_at_defaulted: !body.observed_at,
  })
}
