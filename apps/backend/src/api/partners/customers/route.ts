import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getPartnerStore, tryGetPartnerStore } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ customers: [], count: 0, offset: 0, limit: 20 })
  }

  const qv = (req.validatedQuery ?? req.query ?? {}) as Record<string, any>
  const q = typeof qv.q === "string" ? qv.q.trim() : ""
  const limit = Number.isFinite(Number(qv.limit)) ? Number(qv.limit) : 20
  const offset = Number.isFinite(Number(qv.offset)) ? Number(qv.offset) : 0

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stores",
    fields: ["customers.*"],
    filters: { id: store.id },
  })

  const customers = (data?.[0] as any)?.customers || []

  // Apply free-text search (q) against email/name/company/phone. The
  // store→customers link join above can't filter on these, so we
  // post-filter in-app (same approach as the inventory-items route).
  // Without this the partner UI search box silently returns the full
  // list (#484).
  const needle = q.toLowerCase()
  const matched = needle
    ? customers.filter((c: any) => {
        const candidates: Array<string | undefined> = [
          c?.email,
          c?.first_name,
          c?.last_name,
          [c?.first_name, c?.last_name].filter(Boolean).join(" ") || undefined,
          c?.company_name,
          c?.phone,
        ]
        return candidates.some(
          (v) => typeof v === "string" && v.toLowerCase().includes(needle)
        )
      })
    : customers

  // Respect offset/limit pagination so the UI's page controls work.
  const safeOffset = offset > 0 ? offset : 0
  const safeLimit = limit > 0 ? limit : matched.length
  const paginated = matched.slice(safeOffset, safeOffset + safeLimit)

  res.json({
    customers: paginated,
    count: matched.length,
    offset: safeOffset,
    limit: safeLimit,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await getPartnerStore(req.auth_context, req.scope)

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const customer = await customerService.createCustomers(req.body as any)

  // Link customer to store
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.create({
    [Modules.STORE]: { store_id: store.id },
    [Modules.CUSTOMER]: { customer_id: customer.id },
  })

  res.status(201).json({ customer })
}
