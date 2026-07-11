import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
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

// Manual provision: allocate a stake to an EXISTING investor (investor_id) OR a
// NEW individual added inline (investor: { name, email? }). The inline path
// creates a *bare* investor record (no login/admin identity, no onboarding
// email) + a company pipeline row so it shows up under the company's investors —
// this is for retroactively recording people/individuals who already hold
// shares, bypassing the deal → payment flow entirely.
const provisionInlineInvestorSchema = z.object({
  name: z.string().min(1, "investor name is required"),
  email: z.string().email().optional(),
  investor_type: z.enum(["individual", "entity", "fund"]).optional().default("individual"),
})

const provisionStakeSchema = stakeSchema
  .extend({
    // New individual to create inline when no investor_id is given.
    investor: provisionInlineInvestorSchema.optional(),
    // Manual provision is settled-by-definition (no payment). Default fully_paid.
    status: stakeSchema.shape.status.default("fully_paid"),
  })
  .refine((v) => !!v.investor_id || !!v.investor, {
    message: "Provide either investor_id (existing) or investor { name } (new)",
  })

// POST /admin/cap-tables/:id/stakes — admin allocates a stake directly (manual
// provision). Bypasses the payment flow; creates the investor inline if needed.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const capTableId = req.params.id
  const parsed = provisionStakeSchema.parse({
    ...(req.body as Record<string, any>),
    cap_table_id: capTableId,
  })
  const { investor: inlineInvestor, ...stakeData } = parsed

  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Resolve the target cap table's company (for the pipeline link on new investors).
  const { data: capTables } = await query.graph({
    entity: "cap_table",
    fields: ["id", "company_id", "currency_code"],
    filters: { id: capTableId },
  })
  const capTable = capTables?.[0]
  if (!capTable) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Cap table not found")
  }

  // Resolve investor_id: existing, or create a bare inline investor + pipeline link.
  let investorId = stakeData.investor_id
  if (!investorId && inlineInvestor) {
    const rand = Math.random().toString(36).slice(2, 8)
    const created = await service.createInvestors({
      name: inlineInvestor.name,
      handle: `inv-${Date.now()}-${rand}`,
      // email is unique + required on the model; synthesize a stable placeholder
      // when the shareholder has none on file (retroactive manual entry).
      email: inlineInvestor.email || `manual-${Date.now()}-${rand}@captable.local`,
      investor_type: inlineInvestor.investor_type,
      status: "active",
      is_verified: true,
      currency_code: capTable.currency_code ?? null,
    } as any)
    investorId = created.id

    // Link to the company so they surface under the company's investors.
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

  const created = await service.createStakes({
    // Optional belongsTo FKs must be explicit null, not undefined (MikroORM).
    share_class_id: null,
    funding_round_id: null,
    ...stakeData,
    investor_id: investorId,
  } as any)

  res.status(201).json({ stake: created })
}
