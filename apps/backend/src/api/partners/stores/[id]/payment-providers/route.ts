import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../helpers"

// Partner-scoped payment-providers discovery endpoint.
//
// Mirrors admin's `GET /admin/payments/payment-providers` from
// `@medusajs/medusa/dist/api/admin/payments/payment-providers/route.js`.
// Same envelope: { payment_providers, count, offset, limit }.
//
// Existence rationale: when the partner UI offers a region create /
// update form, it needs to populate the "which payment providers can I
// attach?" picker. Without this route the UI has to hardcode the
// provider id list, which drifts the moment a new provider is enabled
// in medusa-config.
//
// Open-list policy: every registered, enabled payment_provider is
// returned. No admin-curated allow-list per partner. See
// feedback_partner_region_extend_not_lockdown.md for the decision and
// when this would change (BYO credentials per partner is a separate
// future module, not this route's concern).

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const queryConfig = (req as any).queryConfig ?? {}
  const filterableFields = (req as any).filterableFields ?? {}

  const pagination = queryConfig.pagination ?? { skip: 0, take: 20 }

  const { data: payment_providers, metadata } = await query.graph({
    entity: "payment_provider",
    filters: filterableFields,
    fields: queryConfig.fields ?? [],
    pagination,
  })

  res.json({
    payment_providers,
    count: metadata?.count ?? payment_providers.length,
    offset: metadata?.skip ?? pagination.skip ?? 0,
    limit: metadata?.take ?? pagination.take ?? 20,
  })
}
