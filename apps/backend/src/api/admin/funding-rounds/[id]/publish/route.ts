import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"

// POST /admin/funding-rounds/:id/publish — open the round so it becomes a deal
// investors can see and participate in. Idempotent.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  await service.updateFundingRounds({
    id: req.params.id,
    status: "open",
    open_date: new Date(),
  } as any)
  const [round] = await service.listFundingRounds({ id: req.params.id } as any)
  res.json({ funding_round: round })
}
