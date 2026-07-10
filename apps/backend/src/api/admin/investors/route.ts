import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createInvestorAdminWithRegistrationWorkflow } from "../../../workflows/investor/create-investor-admin"
import { INVESTOR_MODULE } from "../../../modules/investor"
import type InvestorService from "../../../modules/investor/service"

// GET /admin/investors — list investors (platform admin)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const offset = Number((req.query as any)?.offset ?? 0)
  const limit = Number((req.query as any)?.limit ?? 20)

  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const [investors, count] = await service.listAndCountInvestors(
    {},
    { skip: offset, take: limit, order: { created_at: "DESC" } }
  )

  res.json({ investors, count, offset, limit })
}

// POST /admin/investors — invite an investor: create the investor + admin, register
// an emailpass identity with a generated temp password, and emit
// `investor.created.fromAdmin` so the onboarding email (username + temp password
// + login link) is sent. This is the invite-only path; there is no self-registration.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
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
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const eventService = req.scope.resolve(Modules.EVENT_BUS)

  // Temp password is only surfaced via the event → onboarding email, never in the
  // response. Logged here for local testing until the email slice lands.
  logger.info(
    `Emitting investor.created.fromAdmin for ${admin.email} (temp password issued)`
  )
  eventService.emit({
    name: "investor.created.fromAdmin",
    data: {
      investor_id: payload.investorWithAdmin.createdInvestor.id,
      investor_admin_id: payload.investorWithAdmin.investorAdmin.id,
      email: admin.email,
      temp_password: payload.registered.tempPassword,
    },
  })

  return res.status(201).json({
    investor: payload.investorWithAdmin.createdInvestor,
    investor_admin: payload.investorWithAdmin.investorAdmin,
  })
}
