/**
 * #2596 — a partner's rate estimates per technique.
 * GET lists them; POST adds one (link written so search finds it).
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PARTNER_CAPABILITY_MODULE } from "../../../../../modules/partner_capability"
import { createCapabilityRateWorkflow } from "../../../../../workflows/partner/capability-rates"
import type { AdminCreateCapabilityRateReq, AdminListCapabilityRatesQuery } from "./validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = ((req as any).validatedQuery || req.query || {}) as AdminListCapabilityRatesQuery
  const service: any = req.scope.resolve(PARTNER_CAPABILITY_MODULE)
  const filters: Record<string, unknown> = { partner_id: req.params.id }
  if (q.technique) filters.technique = q.technique
  const [rates, count] = await service.listAndCountPartnerCapabilityRates(filters, {
    order: { technique: "ASC", observed_at: "DESC" },
    take: 200,
  })
  res.json({ rates, count })
}

export const POST = async (
  req: MedusaRequest<AdminCreateCapabilityRateReq>,
  res: MedusaResponse
) => {
  const { result } = await createCapabilityRateWorkflow(req.scope).run({
    input: { ...(req.validatedBody as AdminCreateCapabilityRateReq), partner_id: req.params.id },
  })
  res.status(201).json(result)
}
