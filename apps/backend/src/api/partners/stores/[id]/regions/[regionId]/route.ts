import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createRegionsWorkflow,
  deleteRegionsWorkflow,
  updateRegionsWorkflow,
  updateShippingOptionsWorkflow,
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

    // Copy shipping-option prices keyed on the old region_id onto the
    // clone, so the partner's existing shipping configuration keeps
    // working without manual re-pricing. We walk the partner's
    // shipping options via the store → location → fulfillment_sets →
    // service_zones chain and, for each price whose price_rules
    // include `region_id = oldRegionId`, push a new price onto the
    // option with `region_id = newRegion.id` and the same amount and
    // currency. `updateShippingOptionsWorkflow` upserts by id
    // presence; passing prices without `id` is additive.
    //
    // Wrapped in try/catch per option — a missing price_set on a stale
    // option shouldn't fail the whole clone. Worst case the partner
    // re-prices manually for that option.
    if (store.default_location_id) {
      try {
        const { data: locations } = await query.graph({
          entity: "stock_locations",
          fields: [
            "fulfillment_sets.service_zones.shipping_options.id",
            "fulfillment_sets.service_zones.shipping_options.prices.amount",
            "fulfillment_sets.service_zones.shipping_options.prices.currency_code",
            "fulfillment_sets.service_zones.shipping_options.prices.price_rules.attribute",
            "fulfillment_sets.service_zones.shipping_options.prices.price_rules.value",
          ],
          filters: { id: store.default_location_id },
        })

        const location = locations?.[0] as any
        for (const fset of location?.fulfillment_sets ?? []) {
          for (const zone of fset?.service_zones ?? []) {
            for (const opt of zone?.shipping_options ?? []) {
              const clonedPrices: Array<{
                amount: number
                currency_code: string
                rules?: Array<{ attribute: string; value: string; operator: string }>
              }> = []
              for (const price of opt?.prices ?? []) {
                const matchesOldRegion = (price?.price_rules ?? []).some(
                  (r: any) => r?.attribute === "region_id" && r?.value === regionId
                )
                if (!matchesOldRegion) continue
                // Preserve any other price_rules besides the region one;
                // swap the region_id rule for the new region.
                const otherRules = (price.price_rules ?? [])
                  .filter((r: any) => r?.attribute !== "region_id")
                  .map((r: any) => ({
                    attribute: r.attribute,
                    value: r.value,
                    operator: r.operator ?? "eq",
                  }))
                clonedPrices.push({
                  amount: price.amount,
                  currency_code: price.currency_code,
                  rules: [
                    { attribute: "region_id", value: newRegion.id, operator: "eq" },
                    ...otherRules,
                  ],
                })
              }
              if (!clonedPrices.length) continue
              try {
                await updateShippingOptionsWorkflow(req.scope).run({
                  input: [{ id: opt.id, prices: clonedPrices } as any],
                })
              } catch (err) {
                // Log via console only — Medusa logger access here is awkward
                // and we don't want to fail the clone over one option.
                // eslint-disable-next-line no-console
                console.warn(
                  `[partner-region clone] failed to copy shipping prices for option ${opt.id}:`,
                  err
                )
              }
            }
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[partner-region clone] failed to enumerate partner shipping options:`,
          err
        )
      }
    }

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
