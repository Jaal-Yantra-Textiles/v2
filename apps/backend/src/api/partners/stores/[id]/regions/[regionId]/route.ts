import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../helpers"

/**
 * Under the marketplace inheritance model (see ../route.ts GET docstring),
 * every partner sees ALL admin-curated regions. There is no per-partner
 * region ownership — any authenticated partner can read any admin region,
 * but none can mutate or delete one.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const regionId = req.params.regionId
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: regions } = await query.graph({
    entity: "region",
    fields: [
      "id",
      "name",
      "currency_code",
      "automatic_taxes",
      "metadata",
      "created_at",
      "updated_at",
      "countries.*",
    ],
    filters: { id: regionId },
  })

  if (!regions?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Region not found")
  }

  let paymentProviders: any[] = []
  try {
    const { data: providerLinks } = await query.graph({
      entity: "region_payment_provider",
      filters: { region_id: regionId },
      fields: ["payment_provider.*"],
    })
    paymentProviders = (providerLinks || [])
      .map((l: any) => l.payment_provider)
      .filter(Boolean)
  } catch {
    // No payment providers linked.
  }

  res.json({ region: { ...regions[0], payment_providers: paymentProviders } })
}

/**
 * POST (update) is intentionally refused.
 *
 * Regions are admin-managed shared infrastructure. Letting a partner
 * mutate one would change behavior for every other partner inheriting
 * that region.
 */
export const POST = async (
  _req: AuthenticatedMedusaRequest,
  _res: MedusaResponse
) => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "Partners cannot modify shared regions. Contact admin to adjust this region."
  )
}

/**
 * DELETE is intentionally refused.
 *
 * Under the marketplace inheritance model, partners don't subscribe to
 * regions — they inherit all of them. So "delete" doesn't have a
 * partner-scoped meaning: there's no per-partner link to dismiss, and
 * deleting the region row itself would break every other partner using
 * it. Admin manages the catalog; partners read it.
 */
export const DELETE = async (
  _req: AuthenticatedMedusaRequest,
  _res: MedusaResponse
) => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "Partners cannot delete regions. Regions are admin-managed; contact admin to remove a region."
  )
}
