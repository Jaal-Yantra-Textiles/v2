import { MedusaError } from "@medusajs/framework/utils"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { INVESTOR_MODULE } from "../../../../modules/investor"
import type InvestorService from "../../../../modules/investor/service"

// POST /admin/funding-rounds/:id — revise a round's target amount, but ONLY
// while no participant has onboarded (no stakes or convertibles on the round).
// The target is the one figure safe to change on a live round before money
// starts landing; once anyone has participated it's locked.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const id = req.params.id

  const target = (req.body as { target_amount?: number | null } | undefined)
    ?.target_amount
  if (target === undefined) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "target_amount is required"
    )
  }
  if (
    target !== null &&
    (typeof target !== "number" || !Number.isFinite(target) || target < 0)
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "target_amount must be a non-negative number or null"
    )
  }

  // Gate: any participant already on the round makes the target immutable.
  // Convertibles link the round by a plain `funding_round_id` text field.
  const [stakes, convertibles] = await Promise.all([
    service.listStakes({ funding_round_id: id } as any, { take: 1 } as any),
    service.listConvertibles({ funding_round_id: id } as any, { take: 1 } as any),
  ])
  if ((stakes?.length ?? 0) > 0 || (convertibles?.length ?? 0) > 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cannot change the target amount — a participant has already onboarded on this round."
    )
  }

  await service.updateFundingRounds({ id, target_amount: target } as any)
  const [round] = await service.listFundingRounds({ id } as any)
  res.json({ funding_round: round })
}
