import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { stakeSchema } from "../../../../investors/validators"

// GET /admin/cap-tables/:id/stakes — stakes on this cap table, with investor info
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stake",
    filters: { cap_table_id: req.params.id },
    fields: [
      "*",
      "investor.id",
      "investor.name",
      "investor.email",
      "share_class.name",
      "funding_round.name",
    ],
  })
  res.json({ stakes: data || [], count: (data || []).length })
}

// POST /admin/cap-tables/:id/stakes — admin allocates a stake directly
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = stakeSchema.parse({ ...(req.body as Record<string, any>), cap_table_id: req.params.id })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createStakes({
    // Optional belongsTo FKs must be explicit null, not undefined (MikroORM).
    share_class_id: null,
    funding_round_id: null,
    ...data,
  } as any)
  res.status(201).json({ stake: created })
}
