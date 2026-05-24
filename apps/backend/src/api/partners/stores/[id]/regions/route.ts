import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../helpers"
import { getPartnerFromAuthContext } from "../../../helpers"
import { PartnerCreateRegionReqType } from "../validators"
import partnerRegionLink from "../../../../../links/partner-region"

// Partner-scoped region routes.
//
// Wire contract mirrors `@medusajs/medusa/dist/api/admin/regions/route.js`
// (see apps/docs/notes/PARTNER_API_PARITY.md). Partner-specific behavior:
//
//   • Ownership scope — only regions linked to this partner via the
//     `partner_region` link are visible. No fallback to
//     `store.default_region_id` (provisioning is expected to always
//     link the default region; if it isn't linked, the partner doesn't
//     own it).
//   • Enrichment — single-region GET inlines `payment_providers` from
//     the `region_payment_provider` join. Allowed under the parity
//     contract because it's an additional field on the resource, not a
//     new top-level envelope key.

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const queryConfig = (req as any).queryConfig ?? {}
  const filterableFields = (req as any).filterableFields ?? {}

  // Partner ownership scope: list the regions linked to this partner.
  const { data: links } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    filters: { partner_id: partner!.id },
    fields: ["region_id"],
  })
  const partnerRegionIds = (links || []).map((l: any) => l.region_id)

  // Admin envelope shape preserved even when the partner has no regions.
  const pagination = queryConfig.pagination ?? { skip: 0, take: 20 }
  if (!partnerRegionIds.length) {
    res.json({
      regions: [],
      count: 0,
      offset: pagination.skip ?? 0,
      limit: pagination.take ?? 20,
    })
    return
  }

  // Combine user filters with partner ownership scope.
  const filters: Record<string, any> = {
    ...filterableFields,
    id: partnerRegionIds,
  }

  const { data: regions, metadata } = await query.graph({
    entity: "region",
    filters,
    fields: queryConfig.fields ?? [],
    pagination,
  })

  // Partner-specific enrichment: inline payment_providers on each
  // region in the list so the partner-ui table view can render a
  // providers column without a per-row GET. Allowed under the parity
  // contract — additional fields on the resource, not new envelope
  // keys. One batched join keyed by region_id.
  let providersByRegion: Record<string, any[]> = {}
  const regionIds = (regions || []).map((r: any) => r.id)
  if (regionIds.length) {
    try {
      const { data: providerLinks } = await query.graph({
        entity: "region_payment_provider",
        filters: { region_id: regionIds },
        fields: ["region_id", "payment_provider.*"],
      })
      for (const link of providerLinks || []) {
        if (!providersByRegion[link.region_id]) {
          providersByRegion[link.region_id] = []
        }
        if (link.payment_provider) {
          providersByRegion[link.region_id].push(link.payment_provider)
        }
      }
    } catch {
      // region_payment_provider link may not exist in some setups
    }
  }

  const enrichedRegions = (regions || []).map((r: any) => ({
    ...r,
    payment_providers: providersByRegion[r.id] || [],
  }))

  res.json({
    regions: enrichedRegions,
    count: metadata?.count ?? enrichedRegions.length,
    offset: metadata?.skip ?? pagination.skip ?? 0,
    limit: metadata?.take ?? pagination.take ?? 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  const body = (req as any).validatedBody as PartnerCreateRegionReqType
  const { payment_providers: paymentProviderIds, ...regionData } = body

  // Stamp the creating partner on the region's metadata so admin (and
  // future analytics / cleanup tooling) can tell partner-created
  // regions apart from admin-seeded ones. Goes into metadata rather
  // than a top-level field to stay inside the admin contract — admin's
  // CreateRegion body has no partner_id slot.
  const regionDataWithProvenance = {
    ...regionData,
    metadata: {
      ...(regionData.metadata ?? {}),
      created_by_partner_id: partner!.id,
    },
  }

  const { result } = await createRegionsWorkflow(req.scope).run({
    input: {
      regions: [regionDataWithProvenance],
    },
  })

  const region = result[0]

  // Link region to partner via the partner-region link.
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.create({
    partner: { partner_id: partner!.id },
    [Modules.REGION]: { region_id: region.id },
  })

  // Link payment providers to the new region.
  if (paymentProviderIds?.length) {
    await remoteLink.create(
      paymentProviderIds.map((providerId: string) => ({
        [Modules.REGION]: { region_id: region.id },
        [Modules.PAYMENT]: { payment_provider_id: providerId },
      }))
    )
  }

  // Auto-expand store.supported_currencies + maybe set default region.
  // Partner-ui's product pricing grid disables the currency column for
  // any region whose currency_code isn't in store.supported_currencies
  // — so without this, a partner could create an Africa/zar region and
  // then be unable to enter prices for it. We just add the missing
  // currency, never replace `is_default`, and don't touch entries that
  // are already there.
  await ensureStoreSupportsCurrencyAndDefault(
    req.scope.resolve(Modules.STORE) as any,
    store,
    region.currency_code,
    region.id
  )

  res.status(201).json({ region })
}

async function ensureStoreSupportsCurrencyAndDefault(
  storeService: any,
  store: any,
  currencyCode: string | undefined,
  newRegionId: string
) {
  const existing = (store.supported_currencies || []) as Array<{
    currency_code: string
    is_default?: boolean
  }>

  const wantedCurrency = currencyCode ? String(currencyCode).toLowerCase() : null
  const needsCurrency =
    !!wantedCurrency &&
    !existing.some(
      (c) => String(c.currency_code).toLowerCase() === wantedCurrency
    )
  const needsDefault = !store.default_region_id

  if (!needsCurrency && !needsDefault) return

  const update: Record<string, any> = { id: store.id }

  if (needsCurrency) {
    update.supported_currencies = [
      ...existing.map((c) => ({
        currency_code: c.currency_code,
        is_default: !!c.is_default,
      })),
      { currency_code: wantedCurrency!, is_default: false },
    ]
  }

  if (needsDefault) {
    update.default_region_id = newRegionId
  }

  await storeService.updateStores(update)
}
