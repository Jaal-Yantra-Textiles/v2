import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../modules/investor"
import type InvestorService from "../../../../modules/investor/service"
import { convertibleUpdateSchema } from "../../../investors/validators"
import { computeConvertibleValue } from "../../../../modules/investor/lib/convertible-value"

// GET /admin/convertibles/:id — one convertible with its payments and derived value.
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "convertible",
    filters: { id: req.params.id },
    fields: [
      "*",
      "investor.id",
      "investor.name",
      "investor.email",
      "cap_table.id",
      "cap_table.post_money_valuation",
      "cap_table.currency_code",
      "payments.*",
    ],
  })
  const convertible = data?.[0]
  if (!convertible) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Convertible not found")
  }
  const value = computeConvertibleValue(convertible, {
    referenceValuation: convertible.cap_table?.post_money_valuation,
  })
  res.json({ convertible: { ...convertible, value } })
}

// POST /admin/convertibles/:id — update terms/status.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = convertibleUpdateSchema.parse(req.body)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const updated = await service.updateConvertibles({ id: req.params.id, ...data } as any)
  res.json({ convertible: updated })
}

// DELETE /admin/convertibles/:id
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  await service.deleteConvertibles(req.params.id)
  res.json({ id: req.params.id, object: "convertible", deleted: true })
}
