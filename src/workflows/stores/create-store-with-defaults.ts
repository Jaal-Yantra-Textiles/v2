import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/workflows-sdk"
import {
  createStoresWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import { PARTNER_MODULE } from "../../modules/partner"

// Orchestrates creation of a store with its default region, sales channel, and stock location
// Then updates the store to reference those as defaults

export type CreateStoreWithDefaultsInput = {
  partner_id: string
  store: {
    name: string
    // Example: [ { currency_code: "usd", is_default: true } ]
    supported_currencies: Array<{ currency_code: string; is_default?: boolean }>
    metadata?: Record<string, any>
  }
  sales_channel?: {
    name?: string // defaults to `${store.name} - Default`
    description?: string
  }
  region: {
    name: string // e.g. "North America"
    currency_code: string // e.g. "usd"
    countries: string[] // e.g. ["us"] lowercased ISO2
    payment_providers?: string[] // e.g. ["pp_system_default"]
    metadata?: Record<string, any>
  }
  location: {
    name: string // e.g. "Main Warehouse"
    address: {
      address_1: string
      address_2?: string | null
      city?: string | null
      province?: string | null
      postal_code?: string | null
      country_code: string // ISO2, e.g. "US" (stock location expects upper-case)
    }
    metadata?: Record<string, any>
  }
}

export type CreateStoreWithDefaultsResult = {
  store: any
  region: any
  sales_channel: any
  location: any
}

// Step: create store
const createStoreStep = createStep(
  "create-store-step",
  async (input: CreateStoreWithDefaultsInput["store"], { container }) => {
    const { result } = await createStoresWorkflow(container).run({
      input: {
        stores: [input],
      },
    })

    const store = result[0]
    return new StepResponse(store, { storeId: store.id })
  }
)

// Step: create sales channel
const createSalesChannelStep = createStep(
  "create-sales-channel-step",
  async (
    input: { name: string; description?: string } & { storeName: string },
    { container }
  ) => {
    const name = input.name || `${input.storeName} - Default`

    const { result } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [
          {
            name,
            description: input.description,
          },
        ],
      },
    })

    return new StepResponse(result[0], { salesChannelId: result[0].id })
  }
)

// Step: create region
const createRegionStep = createStep<CreateStoreWithDefaultsInput["region"], any, { regionId: string }>(
  "create-region-step",
  async (input: CreateStoreWithDefaultsInput["region"], { container }) => {
    // Reuse an existing region if any requested country already belongs to one
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const existingRegionsRes = await query.graph({
      entity: "region",
      fields: ["id", "currency_code", "countries.*"],
    })
    const regions = existingRegionsRes?.data || []

    const reqCountries = (input.countries || []).map((c) => String(c).toLowerCase())

    const matchedRegion = regions.find((r: any) => {
      const countries = Array.isArray(r?.countries) ? r.countries : []
      return countries.some((ct: any) => {
        const code = String(ct?.iso_2 || ct?.country_code || ct?.code || "").toLowerCase()
        return reqCountries.includes(code)
      })
    })

    if (matchedRegion) {
      return new StepResponse(matchedRegion as any, { regionId: matchedRegion.id })
    }

    // Otherwise, create a new region
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: input.name,
            currency_code: input.currency_code,
            countries: input.countries,
            payment_providers: input.payment_providers,
            metadata: input.metadata,
          },
        ],
      },
    })

    const region = result[0]
    return new StepResponse(region as any, { regionId: region.id })
  }
)

// Step: create stock location
const createLocationStep = createStep(
  "create-stock-location-step",
  async (input: CreateStoreWithDefaultsInput["location"], { container }) => {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: input.name,
            address: input.address,
            metadata: input.metadata,
          },
        ],
      },
    })

    return new StepResponse(result[0], { locationId: result[0].id })
  }
)

// Step: update store defaults and link SC <-> Location
const finalizeDefaultsStep = createStep(
  "finalize-store-defaults-step",
  async (
    input: {
      storeId: string
      salesChannelId: string
      regionId: string
      locationId: string
      supported_currencies: Array<{ currency_code: string; is_default?: boolean }>
    },
    { container }
  ) => {
    // Link sales channel to stock location (so the channel can sell from this location)
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: {
        id: input.locationId,
        add: [input.salesChannelId],
      },
    })

    // Update store to reference defaults and supported currencies
    const { result } = await updateStoresWorkflow(container).run({
      input: {
        selector: { id: input.storeId },
        update: {
          supported_currencies: input.supported_currencies,
          default_sales_channel_id: input.salesChannelId,
          default_region_id: input.regionId,
          default_location_id: input.locationId,
        },
      },
    })

    return new StepResponse(result)
  }
)

// Step: link newly created store to the partner
const linkPartnerToStoreStep = createStep(
  "link-partner-to-store-step",
  async (
    input: { partner_id: string; store_id: string },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const links = [
      {
        [PARTNER_MODULE]: { partner_id: input.partner_id },
        [Modules.STORE]: { store_id: input.store_id },
        data: { 
            partner_id:  input.partner_id,
            store_id: input.store_id,
            linked_with: "partner_store"
        },
      } as any,
    ]
    await remoteLink.create(links)
    return new StepResponse(links)
  }
)

export const createStoreWithDefaultsWorkflow = createWorkflow(
  "create-store-with-defaults",
  (input: CreateStoreWithDefaultsInput) => {
    const store = createStoreStep(input.store)

    const salesChannel = createSalesChannelStep({
      storeName: input.store.name,
      name: input.sales_channel?.name || "",
      description: input.sales_channel?.description,
    })

    const region = createRegionStep(input.region)

    const location = createLocationStep(input.location)

    const _updatedStore = finalizeDefaultsStep({
      storeId: store.id,
      salesChannelId: salesChannel.id,
      regionId: region.id,
      locationId: location.id,
      supported_currencies: input.store.supported_currencies,
    })

    // Always link using explicit partner_id from workflow input
    linkPartnerToStoreStep({ partner_id: input.partner_id, store_id: store.id })

    return new WorkflowResponse({
      store,
      region,
      sales_channel: salesChannel,
      location,
    } as CreateStoreWithDefaultsResult)
  }
)
