import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess, getPartnerFromAuthContext } from "../../../../helpers"
import { PartnerUpdateRegionReqType } from "../../validators"
import partnerRegionLink from "../../../../../../links/partner-region"

// Partner-scoped single-region routes. See sibling `route.ts` for the
// wire-contract / parity rules. This file enforces ownership via the
// `partner_region` link as the *only* source of truth — no fallback to
// `store.default_region_id`. Provisioning is expected to always link
// the partner's default region; if it isn't linked, the partner
// doesn't own it.

async function verifyRegionOwnership(req: AuthenticatedMedusaRequest) {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  const regionId = req.params.regionId
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: links } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    filters: { partner_id: partner!.id, region_id: regionId },
    fields: ["region_id"],
  })

  if (!links?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Region with id "${regionId}" not found`
    )
  }

  return { store, partner, regionId }
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { regionId } = await verifyRegionOwnership(req)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const queryConfig = (req as any).queryConfig ?? {}

  const { data: regions } = await query.graph({
    entity: "region",
    fields: queryConfig.fields ?? [],
    filters: { id: regionId },
  })

  if (!regions?.[0]) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Region with id "${regionId}" not found`
    )
  }

  // Partner-specific enrichment: inline payment providers from the
  // region_payment_provider join. Allowed under the parity contract —
  // additional field on the resource, not a new envelope key.
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
    // Link may not exist
  }

  res.json({ region: { ...regions[0], payment_providers: paymentProviders } })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { regionId } = await verifyRegionOwnership(req)

  const body = (req as any).validatedBody as PartnerUpdateRegionReqType
  const { payment_providers: paymentProviderIds, ...regionData } = body

  const regionService = req.scope.resolve(Modules.REGION) as any
  const updated = await regionService.updateRegions({
    id: regionId,
    ...regionData,
  })

  if (paymentProviderIds) {
    const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
    try {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data: existingLinks } = await query.graph({
        entity: "region_payment_provider",
        filters: { region_id: regionId },
        fields: ["payment_provider_id"],
      })
      if (existingLinks?.length) {
        await remoteLink.dismiss(
          existingLinks.map((l: any) => ({
            [Modules.REGION]: { region_id: regionId },
            [Modules.PAYMENT]: { payment_provider_id: l.payment_provider_id },
          }))
        )
      }
    } catch {
      // No existing links
    }
    if (paymentProviderIds.length > 0) {
      await remoteLink.create(
        paymentProviderIds.map((providerId: string) => ({
          [Modules.REGION]: { region_id: regionId },
          [Modules.PAYMENT]: { payment_provider_id: providerId },
        }))
      )
    }
  }

  res.json({ region: updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store, partner, regionId } = await verifyRegionOwnership(req)

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  try {
    await remoteLink.dismiss({
      partner: { partner_id: partner!.id },
      [Modules.REGION]: { region_id: regionId },
    })
  } catch {
    // Link may not exist
  }

  await deleteRegionsWorkflow(req.scope).run({ input: { ids: [regionId] } })

  if (store.default_region_id === regionId) {
    const storeService = req.scope.resolve(Modules.STORE) as any
    await storeService.updateStores({
      id: store.id,
      default_region_id: null,
    })
  }

  res.json({ id: regionId, object: "region", deleted: true })
}
