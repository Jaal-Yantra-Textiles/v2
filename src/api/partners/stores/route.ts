/**
 * @file Partner API routes for managing stores
 * @description Provides endpoints for creating and listing stores associated with a partner in the JYT Commerce platform
 * @module API/Partner/Stores
 */

/**
 * @typedef {Object} PartnerStoreInput
 * @property {Object} store - Store data to create
 * @property {string} store.name - The name of the store
 * @property {string} [store.metadata] - Additional metadata for the store
 * @property {string} [store.metadata.partner_id] - Partner ID associated with the store
 * @property {string} [store.currency_code] - Default currency code for the store
 * @property {string} [store.default_sales_channel_id] - Default sales channel ID for the store
 * @property {string} [store.default_location_id] - Default location ID for the store
 * @property {string} [store.default_region_id] - Default region ID for the store
 */

/**
 * @typedef {Object} PartnerStoreResponse
 * @property {string} id - The unique identifier of the store
 * @property {string} name - The name of the store
 * @property {string} partner_id - The ID of the partner associated with the store
 * @property {string} currency_code - Default currency code for the store
 * @property {string} default_sales_channel_id - Default sales channel ID for the store
 * @property {string} default_location_id - Default location ID for the store
 * @property {string} default_region_id - Default region ID for the store
 * @property {Object} metadata - Additional metadata for the store
 * @property {Date} created_at - When the store was created
 * @property {Date} updated_at - When the store was last updated
 * @property {Object[]} sales_channel - Array of sales channels associated with the store
 * @property {Object[]} location - Array of locations associated with the store
 * @property {Object[]} region - Array of regions associated with the store
 */

/**
 * @typedef {Object} PartnerStoresListResponse
 * @property {string} partner_id - The ID of the partner
 * @property {number} count - The number of stores
 * @property {PartnerStoreResponse[]} stores - Array of stores associated with the partner
 */

/**
 * List stores associated with a partner
 * @route GET /partners/stores
 * @group Partner - Operations related to partners
 * @returns {PartnerStoresListResponse} 200 - List of stores associated with the partner
 * @throws {MedusaError} 401 - Unauthorized if partner authentication is required
 * @throws {MedusaError} 401 - Unauthorized if no partner is associated with this admin
 * @throws {MedusaError} 404 - Not found if no default sales channel, location, or region is found for a store
 *
 * @example request
 * GET /partners/stores
 *
 * @example response 200
 * {
 *   "partner_id": "partner_123456789",
 *   "count": 2,
 *   "stores": [
 *     {
 *       "id": "store_123456789",
 *       "name": "My Store",
 *       "partner_id": "partner_123456789",
 *       "currency_code": "USD",
 *       "default_sales_channel_id": "sc_123456789",
 *       "default_location_id": "loc_123456789",
 *       "default_region_id": "reg_123456789",
 *       "metadata": {
 *         "partner_id": "partner_123456789"
 *       },
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z",
 *       "sales_channel": [
 *         {
 *           "id": "sc_123456789",
 *           "name": "Online Store",
 *           "description": "Main online sales channel"
 *         }
 *       ],
 *       "location": [
 *         {
 *           "id": "loc_123456789",
 *           "name": "Main Warehouse",
 *           "address": {
 *             "address_1": "123 Main St",
 *             "city": "New York",
 *             "country_code": "US"
 *           }
 *         }
 *       ],
 *       "region": [
 *         {
 *           "id": "reg_123456789",
 *           "name": "United States",
 *           "currency_code": "USD"
 *         }
 *       ]
 *     },
 *     {
 *       "id": "store_987654321",
 *       "name": "My Second Store",
 *       "partner_id": "partner_123456789",
 *       "currency_code": "USD",
 *       "default_sales_channel_id": "sc_987654321",
 *       "default_location_id": "loc_987654321",
 *       "default_region_id": "reg_987654321",
 *       "metadata": {
 *         "partner_id": "partner_123456789"
 *       },
 *       "created_at": "2023-01-02T00:00:00Z",
 *       "updated_at": "2023-01-02T00:00:00Z",
 *       "sales_channel": [
 *         {
 *           "id": "sc_987654321",
 *           "name": "Secondary Online Store",
 *           "description": "Secondary online sales channel"
 *         }
 *       ],
 *       "location": [
 *         {
 *           "id": "loc_987654321",
 *           "name": "Secondary Warehouse",
 *           "address": {
 *             "address_1": "456 Secondary St",
 *             "city": "Los Angeles",
 *             "country_code": "US"
 *           }
 *         }
 *       ],
 *       "region": [
 *         {
 *           "id": "reg_987654321",
 *           "name": "United States",
 *           "currency_code": "USD"
 *         }
 *       ]
 *     }
 *   ]
 * }
 */

/**
 * Create a new store for a partner
 * @route POST /partners/stores
 * @group Partner - Operations related to partners
 * @param {PartnerStoreInput} request.body.required - Store data to create
 * @returns {Object} 201 - Created store object with associated resources
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized if partner authentication is required
 * @throws {MedusaError} 401 - Unauthorized if no partner is associated with this admin
 *
 * @example request
 * POST /partners/stores
 * {
 *   "store": {
 *     "name": "My New Store",
 *     "currency_code": "USD",
 *     "metadata": {
 *       "partner_id": "partner_123456789"
 *     }
 *   }
 * }
 *
 * @example response 201
 * {
 *   "message": "Store created with defaults",
 *   "partner_id": "partner_123456789",
 *   "store": {
 *     "id": "store_123456789",
 *     "name": "My New Store",
 *     "partner_id": "partner_123456789",
 *     "currency_code": "USD",
 *     "default_sales_channel_id": "sc_123456789",
 *     "default_location_id": "loc_123456789",
 *     "default_region_id": "reg_123456789",
 *     "metadata": {
 *       "partner_id": "partner_123456789"
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   },
 *   "sales_channel": {
 *     "id": "sc_123456789",
 *     "name": "Online Store",
 *     "description": "Main online sales channel"
 *   },
 *   "region": {
 *     "id": "reg_123456789",
 *     "name": "United States",
 *     "currency_code": "USD"
 *   },
 *   "location": {
 *     "id": "loc_123456789",
 *     "name": "Main Warehouse",
 *     "address": {
 *       "address_1": "123 Main St",
 *       "city": "New York",
 *       "country_code": "US"
 *     }
 *   }
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PartnerCreateStoreReq } from "./validators"
import { createStoreWithDefaultsWorkflow } from "../../../workflows/stores/create-store-with-defaults"
import { getPartnerFromAuthContext } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {

  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
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
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
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
