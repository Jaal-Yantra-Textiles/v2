import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import {
  assertPreferenceWritable,
  isPreferenceInScope,
  resolvePricePreferenceScope,
} from "./lib/scope"

/**
 * Partner-scoped price preferences (tax-inclusivity per currency or region).
 *
 * This route used to list EVERY price preference on the platform — the query
 * carried no filters — and create one from an unchecked body. The only guard
 * was "are you a partner". See `lib/scope.ts` for why this surface needs a
 * scope rule rather than an ownership link: a `price_preference` is keyed by
 * currency or region, and neither has a partner dimension.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { scope } = await resolvePricePreferenceScope(req.auth_context, req.scope)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: preferences } = await query.graph({
    entity: "price_preferences",
    fields: ["*"],
  })

  // Filtered in the handler rather than the query: the scope is a union of two
  // different attributes, and expressing that as graph filters would be a
  // second copy of the rule that `lib/scope.ts` already owns.
  const visible = ((preferences || []) as any[]).filter((p) =>
    isPreferenceInScope(p, scope)
  )

  res.json({
    price_preferences: visible,
    count: visible.length,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { scope } = await resolvePricePreferenceScope(req.auth_context, req.scope)

  const body = req.body as Record<string, any>
  assertPreferenceWritable(
    { attribute: body?.attribute, value: body?.value },
    scope
  )

  const pricingService = req.scope.resolve(Modules.PRICING) as any
  const preference = await pricingService.createPricePreferences(body)

  res.status(201).json({ price_preference: preference })
}
