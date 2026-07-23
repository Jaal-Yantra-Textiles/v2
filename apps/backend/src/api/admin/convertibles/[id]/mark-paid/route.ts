import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"

// POST /admin/convertibles/:id/mark-paid — settle a SAFE / convertible / CCPS
// participation manually: mark its payment(s) completed. The convertible's own
// status stays "outstanding" (a paid convertible is an active/outstanding
// instrument until it converts or is redeemed). This is the manual counterpart
// to the PayU webhook for the convertible rail, mirroring stakes' mark-paid —
// unlike stakes there is no `fully_paid` instrument state, so "paid" lives on
// the Payment and is what the cap table / portfolio gate on.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)

  const payments: any[] = await service.listPayments({
    convertible_id: req.params.id,
  } as any)
  for (const p of payments) {
    if (p.status !== "completed") {
      await service.updatePayments({
        id: p.id,
        status: "completed",
        paid_date: new Date(),
      } as any)
    }
  }

  res.json({ ok: true })
}
