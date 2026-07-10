import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { fundingRoundSchema } from "../../../../investors/validators"

// GET /admin/cap-tables/:id/funding-rounds — a "deal" is an open funding round
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const items = await service.listFundingRounds({ cap_table_id: req.params.id } as any)
  res.json({ funding_rounds: items, count: items.length })
}

// POST /admin/cap-tables/:id/funding-rounds
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = fundingRoundSchema.parse({ ...(req.body as Record<string, any>), cap_table_id: req.params.id })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createFundingRounds(data as any)
  res.status(201).json({ funding_round: created })
}
