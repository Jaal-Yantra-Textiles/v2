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
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
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
  api_key: any
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
    // Auto-select payment providers based on currency/country
    let paymentProviders: string[]
    if (input.payment_providers?.length) {
      paymentProviders = input.payment_providers
    } else {
      paymentProviders = ["pp_system_default"]

      // Check which providers are available
      const { data: availableProviders } = await query.graph({
        entity: "payment_provider",
        fields: ["id", "is_enabled"],
      })
      const enabledProviderIds = (availableProviders || [])
        .filter((p: any) => p.is_enabled !== false)
        .map((p: any) => p.id)

      // Add Stripe if available
      if (enabledProviderIds.includes("pp_stripe_stripe")) {
        paymentProviders.push("pp_stripe_stripe")
      }

      // Add PayU for Indian regions (INR currency or IN country)
      const isIndianRegion =
        input.currency_code === "inr" ||
        reqCountries.includes("in")
      if (isIndianRegion && enabledProviderIds.includes("pp_payu_payu")) {
        paymentProviders.push("pp_payu_payu")
      }
    }

    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: input.name,
            currency_code: input.currency_code,
            countries: input.countries,
            payment_providers: paymentProviders,
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

// Step: create publishable API key and link to sales channel
const createPublishableApiKeyStep = createStep(
  "create-publishable-api-key-step",
  async (
    input: { storeName: string; salesChannelId: string },
    { container }
  ) => {
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: `${input.storeName} - Publishable Key`,
            type: "publishable",
            created_by: "",
          },
        ],
      },
    })

    const apiKey = result[0]

    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: {
        id: apiKey.id,
        add: [input.salesChannelId],
      },
    })

    return new StepResponse(apiKey, { apiKeyId: apiKey.id })
  }
)

// Step: auto-link fulfillment providers to location based on country
const autoLinkFulfillmentProvidersStep = createStep(
  "auto-link-fulfillment-providers",
  async (
    input: { locationId: string; countryCode: string },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>

    // Get all available fulfillment providers
    const { data: providers } = await query.graph({
      entity: "fulfillment_provider",
      fields: ["id", "is_enabled"],
    })

    const available = (providers || []) as unknown as Array<{ id: string; is_enabled: boolean }>
    const enabledIds = available.filter((p) => p.is_enabled !== false).map((p) => p.id)

    const country = input.countryCode.toLowerCase()

    // Determine which providers to link based on country
    const toLink: string[] = []

    // Always add manual
    if (enabledIds.includes("manual_manual")) {
      toLink.push("manual_manual")
    }

    // India → Delhivery
    if (country === "in" && enabledIds.includes("delhivery_delhivery")) {
      toLink.push("delhivery_delhivery")
    }

    // EU countries → DHL
    const euCountries = new Set([
      "de", "fr", "it", "es", "nl", "be", "at", "pt", "ie", "fi",
      "se", "dk", "pl", "cz", "gr", "hu", "ro", "bg", "hr", "sk",
      "si", "lt", "lv", "ee", "lu", "mt", "cy", "gb", "ch", "no",
    ])
    if (euCountries.has(country) && enabledIds.includes("dhl-express_dhl-express")) {
      toLink.push("dhl-express_dhl-express")
    }

    // US/CA → UPS or FedEx
    if ((country === "us" || country === "ca")) {
      if (enabledIds.includes("ups_ups")) toLink.push("ups_ups")
      if (enabledIds.includes("fedex_fedex")) toLink.push("fedex_fedex")
    }

    // Australia → AusPost
    if (country === "au" && enabledIds.includes("auspost_auspost")) {
      toLink.push("auspost_auspost")
    }

    // Link providers to the stock location
    for (const providerId of toLink) {
      try {
        await remoteLink.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: input.locationId },
          [Modules.FULFILLMENT]: { fulfillment_provider_id: providerId },
        } as any)
      } catch {
        // Provider may already be linked or not available
      }
    }

    // Auto-create shipping + pickup fulfillment sets with a service zone
    const fulfillmentService = container.resolve(Modules.FULFILLMENT) as any
    const countryUpper = country.toUpperCase()

    try {
      // Create shipping fulfillment set
      const shippingSet = await fulfillmentService.createFulfillmentSets({
        name: "Shipping",
        type: "shipping",
        service_zones: [
          {
            name: `${countryUpper} Shipping Zone`,
            geo_zones: [{ country_code: countryUpper, type: "country" }],
          },
        ],
      })
      // Link shipping set to the stock location
      await remoteLink.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: input.locationId },
        [Modules.FULFILLMENT]: { fulfillment_set_id: shippingSet.id },
      } as any)

      // Create pickup fulfillment set
      const pickupSet = await fulfillmentService.createFulfillmentSets({
        name: "In-Store Pickup",
        type: "pickup",
        service_zones: [
          {
            name: `${countryUpper} Pickup Zone`,
            geo_zones: [{ country_code: countryUpper, type: "country" }],
          },
        ],
      })
      // Link pickup set to the stock location
      await remoteLink.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: input.locationId },
        [Modules.FULFILLMENT]: { fulfillment_set_id: pickupSet.id },
      } as any)

      console.log(
        `[create-store] Created shipping + pickup fulfillment sets for ${countryUpper}`
      )

      // Auto-create default shipping options for the shipping zone
      const serviceZone = shippingSet.service_zones?.[0]
      if (serviceZone) {
        try {
          // Get a shipping profile
          const shippingProfiles = await fulfillmentService.listShippingProfiles({}, { take: 1 })
          const profileId = shippingProfiles?.[0]?.id

          if (profileId) {
            // Determine which fulfillment provider to use based on country
            const providerMap: Record<string, string> = {
              in: "fp_delhivery",
            }
            const providerId = providerMap[country.toLowerCase()] || "fp_manual-fulfillment_manual-fulfillment"

            // Standard shipping
            await fulfillmentService.createShippingOptions({
              name: "Standard Shipping",
              price_type: "flat",
              service_zone_id: serviceZone.id,
              shipping_profile_id: profileId,
              provider_id: providerId,
              type: {
                label: "Standard",
                description: "Standard delivery",
                code: "standard",
              },
              data: {},
              rules: [],
            })

            // Return option
            await fulfillmentService.createShippingOptions({
              name: "Return Shipping",
              price_type: "flat",
              service_zone_id: serviceZone.id,
              shipping_profile_id: profileId,
              provider_id: providerId,
              type: {
                label: "Return",
                description: "Return pickup",
                code: "return",
              },
              data: { is_return: true },
              rules: [],
            })

            console.log(`[create-store] Created default shipping options for ${countryUpper}`)
          }
        } catch (shippingErr: any) {
          console.error(`[create-store] Failed to create shipping options: ${shippingErr.message}`)
        }
      }
    } catch (e: any) {
      console.error(`[create-store] Failed to create fulfillment sets: ${e.message}`)
    }

    console.log(
      `[create-store] Auto-linked ${toLink.length} fulfillment providers for country=${country}:`,
      toLink
    )

    return new StepResponse({ linked: toLink })
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

    // Create publishable API key linked to the sales channel
    const apiKey = createPublishableApiKeyStep({
      storeName: input.store.name,
      salesChannelId: salesChannel.id,
    })

    // Auto-link fulfillment providers based on partner's country
    autoLinkFulfillmentProvidersStep({
      locationId: location.id,
      countryCode: input.location.address.country_code,
    })

    // Always link using explicit partner_id from workflow input
    linkPartnerToStoreStep({ partner_id: input.partner_id, store_id: store.id })

    return new WorkflowResponse({
      store,
      region,
      sales_channel: salesChannel,
      location,
      api_key: apiKey,
    } as CreateStoreWithDefaultsResult)
  }
)
