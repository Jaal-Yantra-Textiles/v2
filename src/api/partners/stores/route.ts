import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PartnerCreateStoreReq } from "./validators"
import { createStoreWithDefaultsWorkflow } from "../../../workflows/stores/create-store-with-defaults"
import { getPartnerFromActorId } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {

  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  const partner = await getPartnerFromActorId(actorId, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this admin")
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partners",
    fields: ["id", "stores.*"],
    filters: { id: partner.id },
  })

  const stores = (data?.[0]?.stores || []) as any[]

  if (!stores.length) {
    return res.status(200).json({
      partner_id: partner.id,
      count: 0,
      stores: [],
    })
  }

  const salesChannelIds = Array.from(
    new Set(stores.map((s) => s?.default_sales_channel_id).filter(Boolean))
  ) as string[]

  const locationIds = Array.from(
    new Set(stores.map((s) => s?.default_location_id).filter(Boolean))
  ) as string[]

  const regionIds = Array.from(
    new Set(stores.map((s) => s?.default_region_id).filter(Boolean))
  ) as string[]

  const { data: salesChannels } = salesChannelIds.length
    ? await query.graph({
        entity: "sales_channels",
        fields: ["*"],
        filters: { id: salesChannelIds as any },
      })
    : { data: [] }

  const { data: stockLocations } = locationIds.length
    ? await query.graph({
        entity: "stock_locations",
        fields: ["*", "address.*"],
        filters: { id: locationIds as any },
      })
    : { data: [] }

  const { data: regions } = regionIds.length
    ? await query.graph({
        entity: "regions",
        fields: ["*"],
        filters: { id: regionIds as any },
      })
    : { data: [] }

  const salesChannelById = new Map(
    (salesChannels || []).map((sc: any) => [String(sc.id), sc])
  )
  const stockLocationById = new Map(
    (stockLocations || []).map((sl: any) => [String(sl.id), sl])
  )
  const regionById = new Map((regions || []).map((r: any) => [String(r.id), r]))

  stores.forEach((store) => {
    const salesChannelId = store?.default_sales_channel_id
    const locationId = store?.default_location_id
    const regionId = store?.default_region_id

    if (!salesChannelId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No default sales channel found for store ${store?.id || ""}`
      )
    }

    if (!locationId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No default location found for store ${store?.id || ""}`
      )
    }

    if (!regionId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No default region found for store ${store?.id || ""}`
      )
    }

    store.sales_channel = salesChannelById.get(String(salesChannelId))
      ? [salesChannelById.get(String(salesChannelId))]
      : []

    store.location = stockLocationById.get(String(locationId))
      ? [stockLocationById.get(String(locationId))]
      : []

    store.region = regionById.get(String(regionId))
      ? [regionById.get(String(regionId))]
      : []
  })

  return res.status(200).json({
    partner_id: partner.id,
    count: stores.length,
    stores,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  // Ensure this user is authenticated as a partner
  const partner = await getPartnerFromActorId(actorId, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this admin")
  }

  // Validate input
  const body = PartnerCreateStoreReq.parse(req.body)

  // Build workflow input: pass explicit partner_id; keep metadata tag for auditing
  const input = {
    partner_id: partner.id,
    ...body,
    store: {
      ...body.store,
      metadata: {
        ...(body.store.metadata || {}),
        partner_id: partner.id,
      },
    },
  }

  const { result } = await createStoreWithDefaultsWorkflow(req.scope).run({
    input,
  })

  return res.status(201).json({
    message: "Store created with defaults",
    partner_id: partner.id,
    store: result.store,
    sales_channel: result.sales_channel,
    region: result.region,
    location: result.location,
  })
}
