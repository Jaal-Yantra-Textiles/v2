import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor } from "../helpers"
import { capTableSchema } from "../validators"
import type { z } from "@medusajs/framework/zod"
import { INVESTOR_MODULE } from "../../../modules/investor"
import InvestorService from "../../../modules/investor/service"
import { refetchCapTable } from "../helpers"

type Body = z.infer<typeof capTableSchema>

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const data = capTableSchema.parse(req.body)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createCapTables(data as any)
  const fresh = await refetchCapTable(created.id, req.scope)
  res.json({ cap_table: fresh })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const capTables = await service.listCapTables(
    {} as any,
    { relations: ["share_classes", "stakes", "funding_rounds"] }
  )
  res.json({ cap_tables: capTables, count: capTables.length })
}
