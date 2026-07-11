import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { convertibleSchema } from "../../../../investors/validators"
import { computeConvertibleValue } from "../../../../../modules/investor/lib/convertible-value"

// GET /admin/cap-tables/:id/convertibles — SAFEs/notes on this cap table, with
// the owning investor and a derived value (implied ownership + implied value
// against the cap table's current post-money valuation).
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: capTables } = await query.graph({
    entity: "cap_table",
    fields: ["id", "post_money_valuation", "currency_code"],
    filters: { id: req.params.id },
  })
  const capTable = capTables?.[0]
  if (!capTable) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Cap table not found")
  }

  const { data } = await query.graph({
    entity: "convertible",
    filters: { cap_table_id: req.params.id },
    fields: [
      "*",
      "investor.id",
      "investor.name",
      "investor.email",
      "payments.id",
      "payments.amount",
      "payments.status",
    ],
  })

  const convertibles = (data || []).map((c: any) => ({
    ...c,
    value: computeConvertibleValue(c, {
      referenceValuation: capTable.post_money_valuation,
    }),
  }))

  res.json({ convertibles, count: convertibles.length })
}

// Manual provision — mirror of the stake provision: allocate a convertible to an
// EXISTING investor (investor_id) OR a NEW individual added inline. Records a
// retroactive SAFE/note for someone who already invested.
const provisionInlineInvestorSchema = z.object({
  name: z.string().min(1, "investor name is required"),
  email: z.string().email().optional(),
  investor_type: z.enum(["individual", "entity", "fund"]).optional().default("individual"),
})

const provisionConvertibleSchema = convertibleSchema
  .extend({
    investor: provisionInlineInvestorSchema.optional(),
  })
  .refine((v) => !!v.investor_id || !!v.investor, {
    message: "Provide either investor_id (existing) or investor { name } (new)",
  })

// POST /admin/cap-tables/:id/convertibles
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const capTableId = req.params.id
  const parsed = provisionConvertibleSchema.parse({
    ...(req.body as Record<string, any>),
    cap_table_id: capTableId,
  })
  const { investor: inlineInvestor, ...convertibleData } = parsed

  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: capTables } = await query.graph({
    entity: "cap_table",
    fields: ["id", "company_id", "currency_code"],
    filters: { id: capTableId },
  })
  const capTable = capTables?.[0]
  if (!capTable) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Cap table not found")
  }

  // Resolve investor_id: existing, or create a bare inline investor + pipeline.
  let investorId = convertibleData.investor_id
  if (!investorId && inlineInvestor) {
    const rand = Math.random().toString(36).slice(2, 8)
    const created = await service.createInvestors({
      name: inlineInvestor.name,
      handle: `inv-${Date.now()}-${rand}`,
      email: inlineInvestor.email || `manual-${Date.now()}-${rand}@captable.local`,
      investor_type: inlineInvestor.investor_type,
      status: "active",
      is_verified: true,
      currency_code: capTable.currency_code ?? null,
    } as any)
    investorId = created.id

    if (capTable.company_id) {
      await service.createPipelines({
        investor_id: investorId,
        company_id: capTable.company_id,
        stage: "closed",
        status: "won",
        source: "manual_provision",
      } as any)
    }
  }

  if (!investorId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Provide either investor_id (existing) or investor { name } (new)"
    )
  }

  const created = await service.createConvertibles({
    funding_round_id: null,
    currency_code: capTable.currency_code ?? null,
    ...convertibleData,
    investor_id: investorId,
  } as any)

  res.status(201).json({ convertible: created })
}
