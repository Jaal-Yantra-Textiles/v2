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
  createShippingOptionsWorkflow,
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
    input: { locationId: string; countryCode: string; currencyCode: string },
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

      // Auto-register warehouse with Delhivery via the provider service
      const suffix = input.locationId.slice(-8)
      const warehouseName = `warehouse-${suffix}`
      try {
        const fulfillmentService = container.resolve(Modules.FULFILLMENT) as any
        // Resolve the Delhivery provider instance from the fulfillment module
        const delhiveryProvider = fulfillmentService.retrieveProviderRegistration
          ? await fulfillmentService.retrieveProviderRegistration("delhivery_delhivery")
          : null

        if (delhiveryProvider?.registerWarehouse) {
          // Fetch location address for registration
          const locQuery = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
          const { data: locations } = await locQuery.graph({
            entity: "stock_location",
            fields: ["id", "name", "address.*", "metadata"],
            filters: { id: input.locationId },
          })
          const loc = (locations as any)?.[0]
          const addr = loc?.address || {}

          await delhiveryProvider.registerWarehouse({
            name: warehouseName,
            phone: addr.phone || "",
            pin: addr.postal_code || "",
            city: addr.city || "",
            address: addr.address_1 || "",
            state: addr.province || "",
            country: "India",
          })

          // Store warehouse name in stock location metadata
          const stockLocationService = container.resolve(Modules.STOCK_LOCATION) as any
          await stockLocationService.updateStockLocations(input.locationId, {
            metadata: {
              ...(loc?.metadata || {}),
              delhivery_warehouse_name: warehouseName,
            },
          })

          console.log(`[create-store] Registered Delhivery warehouse: ${warehouseName}`)
        } else {
          console.warn(`[create-store] Delhivery provider not found or registerWarehouse not available`)
        }
      } catch (e: any) {
        console.error(`[create-store] Failed to register Delhivery warehouse: ${e.message}`)
      }
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
    const countryLower = country.toLowerCase()
    const countryLabel = country.toUpperCase()

    // Use location ID suffix to guarantee unique names across partners
    const suffix = input.locationId.slice(-8)

    try {
      // Create shipping fulfillment set
      const shippingSet = await fulfillmentService.createFulfillmentSets({
        name: `Shipping (${suffix})`,
        type: "shipping",
        service_zones: [
          {
            name: `${countryLabel} Shipping Zone (${suffix})`,
            geo_zones: [{ country_code: countryLower, type: "country" }],
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
        name: `Pickup (${suffix})`,
        type: "pickup",
        service_zones: [
          {
            name: `${countryLabel} Pickup Zone (${suffix})`,
            geo_zones: [{ country_code: countryLower, type: "country" }],
          },
        ],
      })
      // Link pickup set to the stock location
      await remoteLink.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: input.locationId },
        [Modules.FULFILLMENT]: { fulfillment_set_id: pickupSet.id },
      } as any)

      console.log(
        `[create-store] Created shipping + pickup fulfillment sets for ${countryLabel}`
      )

      // Auto-create shipping options with tiered pricing based on region
      const serviceZone = shippingSet.service_zones?.[0]
      if (serviceZone) {
        try {
          const shippingProfiles = await fulfillmentService.listShippingProfiles({}, { take: 1 })
          const profileId = shippingProfiles?.[0]?.id

          if (profileId) {
            // Determine provider and currency-specific pricing
            const providerMap: Record<string, string> = {
              in: "delhivery_delhivery",
            }
            const providerId = providerMap[countryLower] || "manual_manual"

            // For Delhivery (calculated pricing) — Delhivery's API returns real-time rates
            // For manual provider — use flat tiered pricing based on country/currency
            const isDelhivery = providerId === "delhivery_delhivery"

            if (isDelhivery) {
              // Delhivery: use calculated pricing (calls calculatePrice on the provider)
              await createShippingOptionsWorkflow(container).run({
                input: [{
                  name: "Standard Shipping",
                  service_zone_id: serviceZone.id,
                  shipping_profile_id: profileId,
                  provider_id: providerId,
                  price_type: "calculated",
                  type: {
                    label: "Standard",
                    description: "Standard delivery via Delhivery",
                    code: "standard",
                  },
                  rules: [
                    { attribute: "enabled_in_store", value: '"true"', operator: "eq" },
                    { attribute: "is_return", value: "false", operator: "eq" },
                  ],
                }],
              })

              // Return option (calculated)
              await createShippingOptionsWorkflow(container).run({
                input: [{
                  name: "Return Shipping",
                  service_zone_id: serviceZone.id,
                  shipping_profile_id: profileId,
                  provider_id: providerId,
                  price_type: "calculated",
                  is_return: true,
                  type: {
                    label: "Return",
                    description: "Return pickup via Delhivery",
                    code: "return",
                  },
                  rules: [
                    { attribute: "enabled_in_store", value: '"true"', operator: "eq" },
                    { attribute: "is_return", value: "true", operator: "eq" },
                  ],
                }],
              })
            } else {
              // Manual provider: flat tiered pricing per region
              // Pricing tiers based on currency:
              //   INR: ₹200 (1 item), ₹150 (2 items), FREE (3+ items)
              //   USD/other: $20 (1 item), $15 (2 items), FREE (3+ items)
              //   EUR: €18 (1 item), €13 (2 items), FREE (3+ items)
              //   GBP: £15 (1 item), £11 (2 items), FREE (3+ items)
              //   AUD: A$25 (1 item), A$18 (2 items), FREE (3+ items)
              const currency = input.currencyCode.toLowerCase()
              const pricingByRegion: Record<string, { base: number; mid: number; ret: number }> = {
                inr: { base: 200, mid: 150, ret: 100 },
                eur: { base: 18, mid: 13, ret: 9 },
                gbp: { base: 15, mid: 11, ret: 8 },
                aud: { base: 25, mid: 18, ret: 12 },
              }
              const pricing = pricingByRegion[currency] || { base: 20, mid: 15, ret: 10 }
              const basePrice = pricing.base
              const midPrice = pricing.mid
              const returnPrice = pricing.ret

              await createShippingOptionsWorkflow(container).run({
                input: [{
                  name: "Standard Shipping",
                  service_zone_id: serviceZone.id,
                  shipping_profile_id: profileId,
                  provider_id: providerId,
                  price_type: "flat",
                  type: {
                    label: "Standard",
                    description: "Standard delivery",
                    code: "standard",
                  },
                  prices: [
                    // Base price: 1 item
                    {
                      currency_code: currency,
                      amount: basePrice,
                    },
                    // 2 items: discounted
                    {
                      currency_code: currency,
                      amount: midPrice,
                      min_quantity: 2,
                      max_quantity: 2,
                    },
                    // 3+ items: free shipping
                    {
                      currency_code: currency,
                      amount: 0,
                      min_quantity: 3,
                    },
                  ],
                  rules: [
                    { attribute: "enabled_in_store", value: '"true"', operator: "eq" },
                    { attribute: "is_return", value: "false", operator: "eq" },
                  ],
                }],
              })

              // Return shipping (flat, no tiers)
              await createShippingOptionsWorkflow(container).run({
                input: [{
                  name: "Return Shipping",
                  service_zone_id: serviceZone.id,
                  shipping_profile_id: profileId,
                  provider_id: providerId,
                  price_type: "flat",
                  is_return: true,
                  type: {
                    label: "Return",
                    description: "Return pickup",
                    code: "return",
                  },
                  prices: [
                    {
                      currency_code: currency,
                      amount: returnPrice,
                    },
                  ],
                  rules: [
                    { attribute: "enabled_in_store", value: '"true"', operator: "eq" },
                    { attribute: "is_return", value: "true", operator: "eq" },
                  ],
                }],
              })
            }

            console.log(
              `[create-store] Created shipping options for ${countryLabel} ` +
              `(${isDelhivery ? "calculated/Delhivery" : "flat tiered/manual"})`
            )
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
      currencyCode: input.region.currency_code,
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
