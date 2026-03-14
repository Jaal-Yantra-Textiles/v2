import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPartnerStore } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await getPartnerStore(req.auth_context, req.scope)

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const query = req.query || {}
  const limit = Number(query.limit) || 20
  const offset = Number(query.offset) || 0

  const filters: Record<string, any> = {}
  if (query.q) {
    filters.q = query.q
  }

  const [customer_groups, count] = await customerService.listAndCountCustomerGroups(
    filters,
    { take: limit, skip: offset, order: { created_at: "DESC" } }
  )

  res.json({
    customer_groups,
    count,
    offset,
    limit,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await getPartnerStore(req.auth_context, req.scope)

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const customer_group = await customerService.createCustomerGroups(req.body as any)

  res.status(201).json({ customer_group })
}
