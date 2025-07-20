import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AdminGetPartnersParamsSchema, AdminGetPartnersParamsType } from "./validators"
import { listPartnersWorkflow } from "../../../../workflows/partners/list-partners"

export const GET = async (
  req: MedusaRequest<AdminGetPartnersParamsType>,
  res: MedusaResponse
) => {
  const validatedQuery = AdminGetPartnersParamsSchema.parse(req.query)
  
  // Build filters from query parameters
  const filters: Record<string, any> = {}
  
  if (validatedQuery.q) {
    // Search across partner fields
    filters.$or = [
      { "name": { $ilike: `%${validatedQuery.q}%` } },
      { "handle": { $ilike: `%${validatedQuery.q}%` } },
    ]
  }
  
  if (validatedQuery.name) {
    filters.name = { $ilike: `%${validatedQuery.name}%` }
  }
  
  if (validatedQuery.handle) {
    filters.handle = { $ilike: `%${validatedQuery.handle}%` }
  }
  
  if (validatedQuery.status) {
    filters.status = validatedQuery.status
  }
  
  if (validatedQuery.is_verified !== undefined) {
    filters.is_verified = validatedQuery.is_verified === 'true'
  }

  const { result } = await listPartnersWorkflow(req.scope).run({
    input: {
      filters,
      fields: validatedQuery.fields,
      offset: validatedQuery.offset,
      limit: validatedQuery.limit,
    },
  })

  const partners = result.data.map((item: any) => ({
    id: item.id,
    partner_id: item.id,
    name: item.name,
    handle: item.handle,
    logo: item.logo,
    status: item.status,
    is_verified: item.is_verified,
    metadata: item.metadata,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }))

  return res.json({
    partners,
    count: result.metadata?.count || partners.length,
    offset: validatedQuery.offset || 0,
    limit: validatedQuery.limit || 20,
  })
}