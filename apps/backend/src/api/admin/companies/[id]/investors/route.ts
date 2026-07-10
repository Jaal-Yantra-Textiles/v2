import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createInvestorAdminWithRegistrationWorkflow } from "../../../../../workflows/investor/create-investor-admin"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"

// GET /admin/companies/:id/investors — investors linked to this company via the
// investor pipeline (each pipeline row belongs to one investor + one company).
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "investor_pipeline",
    fields: ["id", "stage", "status", "investor.*"],
    filters: { company_id: req.params.id },
  })

  const investors = (data || [])
    .filter((p: any) => p?.investor?.id)
    .map((p: any) => ({
      ...p.investor,
      pipeline_id: p.id,
      pipeline_stage: p.stage,
      pipeline_status: p.status,
    }))

  res.json({ investors, count: investors.length })
}

// POST /admin/companies/:id/investors — invite an investor into this company:
// create the investor + admin + emailpass identity (temp password), link them to
// the company via a pipeline row, and emit investor.created.fromAdmin (onboarding email).
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const companyId = req.params.id
  const { admin, ...investorData } = req.validatedBody as any

  if (!investorData.handle) {
    investorData.handle = `inv-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
  }

  const { result, errors } = await createInvestorAdminWithRegistrationWorkflow(
    req.scope
  ).run({
    input: { investor: investorData, admin },
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to create investor"
      )
    )
  }

  const payload = result as any
  const investorId = payload.investorWithAdmin.createdInvestor.id

  // Link the new investor to this company via a pipeline row.
  const investorService: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  await investorService.createPipelines({
    investor_id: investorId,
    company_id: companyId,
    stage: "lead",
    status: "active",
  } as any)

  const eventService = req.scope.resolve(Modules.EVENT_BUS)
  eventService.emit({
    name: "investor.created.fromAdmin",
    data: {
      investor_id: investorId,
      investor_admin_id: payload.investorWithAdmin.investorAdmin.id,
      email: admin.email,
      temp_password: payload.registered.tempPassword,
      company_id: companyId,
    },
  })

  return res.status(201).json({
    investor: payload.investorWithAdmin.createdInvestor,
    investor_admin: payload.investorWithAdmin.investorAdmin,
  })
}
