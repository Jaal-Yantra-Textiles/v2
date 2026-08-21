import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deletePricePreferencesWorkflow } from "@medusajs/medusa/core-flows"

import {
  assertPreferenceWritable,
  isPreferenceInScope,
  resolvePricePreferenceScope,
} from "../lib/scope"

/**
 * A single price preference, scoped to what this partner may see and change.
 *
 * All three verbs previously took the id straight from the URL with no check
 * beyond "are you a partner", so any partner could read, edit or DELETE any
 * other partner's tax-inclusivity setting.
 *
 * Out-of-scope reads 404 rather than 403, matching every other partner guard:
 * a partner probing ids must not learn that something exists but is not theirs.
 * Writes, by contrast, return NOT_ALLOWED **with the reason** — a partner who
 * can see a preference and cannot change it deserves to know whether that is
 * because it is shared or because it is platform-wide.
 */
const loadInScope = async (req: AuthenticatedMedusaRequest) => {
  const { scope } = await resolvePricePreferenceScope(req.auth_context, req.scope)

  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: preferences } = await query.graph({
    entity: "price_preferences",
    fields: ["*"],
    filters: { id },
  })

  const preference = (preferences || [])[0] as any
  if (!preference || !isPreferenceInScope(preference, scope)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Price preference ${id} not found`
    )
  }

  return { preference, scope }
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { preference } = await loadInScope(req)
  res.json({ price_preference: preference })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { preference, scope } = await loadInScope(req)

  // Checked against the STORED row, not the body: an update that renamed the
  // attribute or value in the payload would otherwise be checked against the
  // thing it was becoming rather than the thing it is.
  assertPreferenceWritable(preference, scope)

  const body = req.body as Record<string, any>
  // …and against the incoming shape too, so a write cannot move a preference
  // out of scope on its way through.
  if (body?.attribute !== undefined || body?.value !== undefined) {
    assertPreferenceWritable(
      {
        attribute: body?.attribute ?? preference.attribute,
        value: body?.value ?? preference.value,
      },
      scope
    )
  }

  const pricingService = req.scope.resolve(Modules.PRICING) as any
  const updated = await pricingService.updatePricePreferences(
    req.params.id,
    body
  )

  res.json({ price_preference: updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { preference, scope } = await loadInScope(req)
  assertPreferenceWritable(preference, scope)

  await deletePricePreferencesWorkflow(req.scope).run({
    input: [req.params.id],
  })

  res.json({ id: req.params.id, object: "price_preference", deleted: true })
}
