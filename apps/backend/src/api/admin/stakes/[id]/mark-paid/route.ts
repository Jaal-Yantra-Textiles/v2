import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"

// POST /admin/stakes/:id/mark-paid — reconcile a participation: mark its
// payment(s) completed and the stake fully_paid. Manual counterpart to the PayU
// webhook (used when settling offline or before webhook auto-reconciliation).
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)

  const payments: any[] = await service.listPayments({ stake_id: req.params.id } as any)
  for (const p of payments) {
    if (p.status !== "completed") {
      await service.updatePayments({
        id: p.id,
        status: "completed",
        paid_date: new Date(),
      } as any)
    }
  }
  await service.updateStakes({ id: req.params.id, status: "fully_paid" } as any)

  res.json({ ok: true })
}
