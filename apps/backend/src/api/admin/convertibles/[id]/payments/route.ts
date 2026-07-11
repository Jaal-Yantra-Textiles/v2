import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { paymentSchema } from "../../../../investors/validators"

// GET /admin/convertibles/:id/payments
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const items = await service.listPayments({ convertible_id: req.params.id } as any)
  res.json({ payments: items, count: items.length })
}

// POST /admin/convertibles/:id/payments — record a payment against a convertible
// (e.g. the SAFE principal wired in). Derives investor/company from the
// convertible when not supplied so the admin only needs amount + method.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "convertible",
    filters: { id: req.params.id },
    fields: ["id", "investor_id", "currency_code", "cap_table.company_id"],
  })
  const convertible = data?.[0]
  if (!convertible) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Convertible not found")
  }

  const parsed = paymentSchema.parse({
    payment_type: "convertible",
    ...(req.body as Record<string, any>),
    convertible_id: req.params.id,
    investor_id: (req.body as any)?.investor_id ?? convertible.investor_id,
    company_id: (req.body as any)?.company_id ?? convertible.cap_table?.company_id,
    currency_code: (req.body as any)?.currency_code ?? convertible.currency_code ?? undefined,
  })

  const created = await service.createPayments(parsed as any)
  res.status(201).json({ payment: created })
}
