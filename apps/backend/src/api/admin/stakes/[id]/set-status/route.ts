import { MedusaError } from "@medusajs/framework/utils"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"

// POST /admin/stakes/:id/set-status — move a participation to a lifecycle state
// that isn't a payment event: reject it, park it as not-followed-up, or reopen
// it back to unpaid. Payment-driven states (fully_paid / partially_paid) go
// through approve / mark-paid / the PayU reconciler, not here.
const ALLOWED = new Set(["rejected", "not_followed_up", "unpaid"])

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)

  const status = (req.body as { status?: string } | undefined)?.status
  if (!status || !ALLOWED.has(status)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `status must be one of: ${[...ALLOWED].join(", ")}`
    )
  }

  await service.updateStakes({ id: req.params.id, status } as any)

  res.json({ ok: true, status })
}
