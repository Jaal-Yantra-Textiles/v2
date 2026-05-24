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

  res.json({
    regions,
    count: metadata?.count ?? regions.length,
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

  const { result } = await createRegionsWorkflow(req.scope).run({
    input: {
      regions: [regionData],
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

  // If the store doesn't have a default region yet, set it.
  if (!store.default_region_id) {
    const storeService = req.scope.resolve(Modules.STORE)
    await (storeService as any).updateStores({
      id: store.id,
      default_region_id: region.id,
    })
  }

  res.status(201).json({ region })
}
