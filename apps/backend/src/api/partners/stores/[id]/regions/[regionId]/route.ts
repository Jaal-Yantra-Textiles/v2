import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createRegionsWorkflow,
  deleteRegionsWorkflow,
  updateRegionsWorkflow,
} from "@medusajs/medusa/core-flows"
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
  const { store, partner, regionId } = await verifyRegionOwnership(req)

  const body = (req as any).validatedBody as PartnerUpdateRegionReqType
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

  // Clone-on-write: if more than one partner is linked to this region
  // row, we don't mutate it in place — that would bleed across tenants.
  // Instead we clone the row, move this partner's link to the clone,
  // and apply the update to the clone. The partner UI sees a normal
  // update response; the seam is hidden. The original row keeps serving
  // other partners exactly as before.
  const { data: allLinks } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    filters: { region_id: regionId },
    fields: ["partner_id"],
  })
  const isShared = (allLinks?.length ?? 0) > 1

  if (isShared) {
    // Read existing region so the clone starts from current state.
    const { data: existing } = await query.graph({
      entity: "region",
      filters: { id: regionId },
      fields: [
        "id",
        "name",
        "currency_code",
        "automatic_taxes",
        "is_tax_inclusive",
        "metadata",
        "countries.iso_2",
      ],
    })
    if (!existing?.[0]) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Region with id "${regionId}" not found`
      )
    }
    const old = existing[0] as any

    // Read existing payment providers so the clone inherits them when
    // the update body doesn't redefine them.
    let oldProviderIds: string[] = []
    try {
      const { data: providerLinks } = await query.graph({
        entity: "region_payment_provider",
        filters: { region_id: regionId },
        fields: ["payment_provider_id"],
      })
      oldProviderIds = (providerLinks || []).map((l: any) => l.payment_provider_id)
    } catch {
      // Link may not exist
    }

    const { payment_providers: bodyProviderIds, ...bodyRegionData } = body

    const mergedInput = {
      name: bodyRegionData.name ?? old.name,
      currency_code: bodyRegionData.currency_code ?? old.currency_code,
      countries:
        bodyRegionData.countries ??
        ((old.countries || []).map((c: any) => c.iso_2).filter(Boolean) as string[]),
      automatic_taxes: bodyRegionData.automatic_taxes ?? old.automatic_taxes,
      is_tax_inclusive: bodyRegionData.is_tax_inclusive ?? old.is_tax_inclusive,
      metadata: bodyRegionData.metadata ?? old.metadata,
      payment_providers: bodyProviderIds ?? oldProviderIds,
    }

    const { result } = await createRegionsWorkflow(req.scope).run({
      input: { regions: [mergedInput] },
    })
    const newRegion = result[0]

    // Move this partner's link from the original row to the clone.
    await remoteLink.dismiss({
      partner: { partner_id: partner!.id },
      [Modules.REGION]: { region_id: regionId },
    })
    await remoteLink.create({
      partner: { partner_id: partner!.id },
      [Modules.REGION]: { region_id: newRegion.id },
    })

    // If the store's default was the original row, point it at the clone.
    if (store.default_region_id === regionId) {
      const storeService = req.scope.resolve(Modules.STORE) as any
      await storeService.updateStores({
        id: store.id,
        default_region_id: newRegion.id,
      })
    }

    // TODO: shipping_option prices keyed on the old region_id need to
    // be copied onto the clone so the partner's existing shipping
    // configuration keeps working. Handled in the next commit.

    res.json({ region: newRegion })
    return
  }

  // Sole owner: update in place via admin's workflow. The workflow
  // accepts the full body shape (matches AdminUpdateRegion), including
  // payment_providers, and manages region_payment_provider links
  // internally — no manual link plumbing needed.
  const { result } = await updateRegionsWorkflow(req.scope).run({
    input: {
      selector: { id: regionId },
      update: body,
    },
  })

  res.json({ region: result[0] })
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
