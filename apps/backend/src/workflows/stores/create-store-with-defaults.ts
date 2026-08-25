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
import { registerShiprocketPickup } from "../../modules/shipping-providers/pickup-locations"

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
    // Reuse an existing region if any requested country already belongs
    // to one — BUT ONLY when the currency_code also matches. Without the
    // currency check, partner A provisioning "India INR" would reuse a
    // seeded "India EUR" region and inherit its currency, silently
    // leaking the EUR partner's region into the INR partner's store.
    // This is the real data-leak source PR #257 identified, and the
    // single most important guardrail for shared-tier safety.
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const existingRegionsRes = await query.graph({
      entity: "region",
      fields: ["id", "currency_code", "countries.*"],
    })
    const regions = existingRegionsRes?.data || []

    const reqCountries = (input.countries || []).map((c) => String(c).toLowerCase())
    const reqCurrency = String(input.currency_code || "").toLowerCase()

    const matchedRegion = regions.find((r: any) => {
      if (String(r?.currency_code || "").toLowerCase() !== reqCurrency) return false
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

    // India → Shiprocket (sibling carrier to Delhivery).
    if (country === "in" && enabledIds.includes("shiprocket_shiprocket")) {
      toLink.push("shiprocket_shiprocket")
    }

    // India → Shiprocket inbound pickup auto-register (#31 §9.3). Resolver-driven:
    // creds come from the external-platform store, so this runs whether or not
    // Shiprocket is in the fulfillment registry. Best-effort — a missing platform
    // record / creds (or an unverified phone) must never fail store provisioning.
    if (country === "in") {
      try {
        const result = await registerShiprocketPickup(container, input.locationId)
        console.log(
          `[create-store] Registered Shiprocket pickup: ${result.name}` +
            (result.already_existed ? " (already existed)" : "")
        )
      } catch (e: any) {
        console.warn(
          `[create-store] Skipped Shiprocket pickup auto-register: ${e.message}`
        )
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
          // #1176: this used to be a bare lookup, and when it came back empty
          // the whole `if (profileId)` block below was skipped — silently, with
          // no log. The store came out with fulfillment sets and service zones
          // but ZERO shipping options, so carts in it could never pick a
          // shipping method, and core's create-fulfillment then died on
          // `shippingOption.provider_id` of undefined (a 500 with no clue).
          //
          // A shipping profile only pre-exists because the seed made one, so
          // any environment provisioning a store before a seed hits this: fresh
          // test DBs always, and a brand-new deployment for real. Create the
          // default profile rather than skip.
          const shippingProfiles = await fulfillmentService.listShippingProfiles({}, { take: 1 })
          let profileId = shippingProfiles?.[0]?.id

          if (!profileId) {
            const created = await fulfillmentService.createShippingProfiles({
              name: "Default",
              type: "default",
            })
            profileId = Array.isArray(created) ? created[0]?.id : created?.id
            console.log(
              `[create-store] No shipping profile existed — created default ${profileId}`
            )
          }

          if (profileId) {
            // Determine provider and currency-specific pricing.
            //
            // The primary carrier per country, in PREFERENCE order — the first
            // one actually registered wins. It used to be a bare
            // `{ in: "delhivery_delhivery" }`, which meant a store whose
            // Delhivery credentials were absent still got a Delhivery option
            // (and no other), so its only calculated carrier was one that could
            // never answer. Preferring a registered carrier makes the map
            // describe what the store CAN ship on rather than what we hoped.
            //
            // Shiprocket sits second rather than first only because Delhivery is
            // the incumbent on live IN stores; both get an option either way —
            // the Shiprocket block further down adds its own regardless, so this
            // ordering decides the "Standard Shipping" default, not availability.
            const providerPreference: Record<string, string[]> = {
              in: ["delhivery_delhivery", "shiprocket_shiprocket"],
            }
            const providerId =
              (providerPreference[countryLower] || []).find((id) =>
                enabledIds.includes(id)
              ) || "manual_manual"

            // A real carrier prices via calculatePrice (live rates); the manual
            // provider cannot, so it gets flat tiered pricing instead. Keyed on
            // "is this a carrier" rather than on Delhivery's id specifically,
            // so adding a carrier to the preference list above does not silently
            // fall through to the manual branch.
            const isCarrier = providerId !== "manual_manual"

            if (isCarrier) {
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
                    description: "Standard delivery — live carrier rates",
                    code: "standard",
                  },
                  rules: [
                    { attribute: "enabled_in_store", value: "true", operator: "eq" },
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
                  type: {
                    label: "Return",
                    description: "Return pickup — live carrier rates",
                    code: "return",
                  },
                  rules: [
                    { attribute: "enabled_in_store", value: "true", operator: "eq" },
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
                    // Base price (default)
                    {
                      currency_code: currency,
                      amount: basePrice,
                    },
                    // 2 items: discounted
                    {
                      currency_code: currency,
                      amount: midPrice,
                      rules: [
                        { attribute: "item_total", operator: "gte" as const, value: midPrice },
                      ],
                    },
                    // 3+ items: free shipping (cart total >= 3x base price)
                    {
                      currency_code: currency,
                      amount: 0,
                      rules: [
                        { attribute: "item_total", operator: "gte" as const, value: basePrice * 3 },
                      ],
                    },
                  ],
                  rules: [
                    { attribute: "enabled_in_store", value: "true", operator: "eq" },
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
                    { attribute: "enabled_in_store", value: "true", operator: "eq" },
                    { attribute: "is_return", value: "true", operator: "eq" },
                  ],
                }],
              })
            }

            console.log(
              `[create-store] Created shipping options for ${countryLabel} ` +
              `(${isCarrier ? `calculated/${providerId}` : "flat tiered/manual"})`
            )

            // The flat rate a lane falls back to, in the store's own price
            // units. One constant so the manual companion option and the
            // Shiprocket option's `data.flat_fallback_amount` cannot drift.
            const FLAT_FALLBACK_AMOUNT = 200

            // --- Shiprocket, alongside Delhivery (#1417) ---------------------
            //
            // Shiprocket was ALREADY linked to every IN stock location above and
            // registered as a fulfillment provider in both configs — but no
            // shipping option was ever created for it, because `providerMap`
            // hardcodes `in -> delhivery_delhivery`. So it was provisioned and
            // invisible: a carrier the store could not actually pick.
            //
            // 🔑 The flat companion is the point of this block, not a nicety. An
            // IN store's domestic zone carried ONLY calculated options, and
            // `buildShippingEstimate` skips calculated options when assembling
            // its manual list — so the store's entire quote freight rested on one
            // live rate call with no fallback, and a carrier hiccup 400'd the
            // whole mint. A flat option gives that path something to fall back to.
            if (
              countryLower === "in" &&
              enabledIds.includes("shiprocket_shiprocket")
            ) {
              try {
                await createShippingOptionsWorkflow(container).run({
                  input: [{
                    name: "Standard Shipping (Shiprocket)",
                    service_zone_id: serviceZone.id,
                    shipping_profile_id: profileId,
                    provider_id: "shiprocket_shiprocket",
                    price_type: "calculated",
                    // What this option costs when Shiprocket will not quote the
                    // lane. Stamped here — the same number the manual companion
                    // below is priced at — so the fallback IS the manual
                    // provider's price rather than a constant that happens to
                    // match it. Editable per store alongside that option.
                    data: { flat_fallback_amount: FLAT_FALLBACK_AMOUNT },
                    type: {
                      label: "Standard",
                      description: "Standard delivery via Shiprocket — live rates",
                      code: `shiprocket-standard-${suffix}`,
                    },
                    rules: [
                      { attribute: "enabled_in_store", value: "true", operator: "eq" },
                      { attribute: "is_return", value: "false", operator: "eq" },
                    ],
                  }] as any,
                })

                await createShippingOptionsWorkflow(container).run({
                  input: [{
                    name: "Standard Shipping (Flat)",
                    service_zone_id: serviceZone.id,
                    shipping_profile_id: profileId,
                    // Deliberately `manual_manual`, not Shiprocket: this option
                    // exists FOR the case where no carrier will quote, so routing
                    // it through a carrier would reintroduce the dependency it is
                    // meant to remove.
                    provider_id: "manual_manual",
                    price_type: "flat",
                    type: {
                      label: "Standard (Flat)",
                      description: "Flat-rate delivery — used when no carrier will quote",
                      code: `flat-fallback-${suffix}`,
                    },
                    prices: [
                      {
                        currency_code: input.currencyCode.toLowerCase(),
                        amount: FLAT_FALLBACK_AMOUNT,
                      },
                    ],
                    rules: [
                      { attribute: "enabled_in_store", value: "true", operator: "eq" },
                      { attribute: "is_return", value: "false", operator: "eq" },
                    ],
                  }] as any,
                })

                console.log(
                  `[create-store] Created Shiprocket calculated + flat fallback options`
                )
              } catch (srErr: any) {
                // Best-effort, like every other carrier block here: a store with
                // Delhivery options is still a usable store.
                console.error(
                  `[create-store] Failed to create Shiprocket options: ${srErr.message}`
                )
              }
            }

            // --- International coverage (mirrors the #954 DP backfill) --------
            // Add an "International" zone covering every OTHER region's countries
            // so a new storefront can sell cross-border out of the box — a manual
            // flat option (+ DHL Express when the carrier is enabled), not just
            // its own domestic country. Best-effort: never fails provisioning.
            try {
              const regionQuery = container.resolve(
                ContainerRegistrationKeys.QUERY
              ) as Omit<RemoteQueryFunction, symbol>
              const { data: regions } = await regionQuery.graph({
                entity: "region",
                fields: ["id", "currency_code", "countries.iso_2"],
              })
              const intlCountries = new Set<string>()
              const intlCurrencies = new Set<string>()
              for (const r of (regions || []) as any[]) {
                for (const c of r.countries || []) {
                  const cc = (c.iso_2 || "").toLowerCase()
                  if (cc && cc !== countryLower) intlCountries.add(cc)
                }
                if (r.currency_code) intlCurrencies.add(r.currency_code.toLowerCase())
              }

              if (intlCountries.size) {
                const intlGeoZones = [...intlCountries].sort().map((cc) => ({
                  country_code: cc,
                  type: "country" as const,
                }))
                const createdZone = await fulfillmentService.createServiceZones({
                  name: `International Zone (${suffix})`,
                  fulfillment_set_id: shippingSet.id,
                  geo_zones: intlGeoZones,
                })
                const intlZone = Array.isArray(createdZone) ? createdZone[0] : createdZone

                // Real flat manual rates (major units) with a free-above tier —
                // editable placeholders; `usd` is the fallback for unlisted ccys.
                const INTL_RATES: Record<string, { base: number; freeAbove: number }> = {
                  usd: { base: 39, freeAbove: 350 },
                  eur: { base: 35, freeAbove: 300 },
                  gbp: { base: 30, freeAbove: 275 },
                  aud: { base: 55, freeAbove: 450 },
                  cad: { base: 50, freeAbove: 400 },
                  inr: { base: 3200, freeAbove: 25000 },
                  idr: { base: 550000, freeAbove: 5000000 },
                }
                const intlPrices: Array<{
                  currency_code: string
                  amount: number
                  rules?: Array<{ attribute: string; operator: "gte"; value: number }>
                }> = []
                /**
                 * The same base rates, keyed by currency, for the CALCULATED
                 * Shiprocket option's fallback.
                 *
                 * 🔴 Built from `INTL_RATES` rather than restated, exactly as
                 * the domestic block derives its fallback from the one
                 * `FLAT_FALLBACK_AMOUNT` constant: when the carrier will not
                 * quote a lane, the buyer must be charged the tier we actually
                 * intended, not a number that merely resembles it.
                 *
                 * Before this, the international option carried no `data` at
                 * all — so an unratable EUR lane fell through to
                 * `DEFAULT_FLAT_FALLBACK` (200, an INR-shaped number) and
                 * charged **€200** against an intended €35. Currency-blind in
                 * the #1424/#1434 way, and silent.
                 */
                const intlFallbackByCurrency: Record<string, number> = {}
                for (const cur of intlCurrencies) {
                  const rate = INTL_RATES[cur] ?? INTL_RATES["usd"]
                  intlPrices.push({ currency_code: cur, amount: rate.base })
                  intlPrices.push({
                    currency_code: cur,
                    amount: 0,
                    rules: [{ attribute: "item_total", operator: "gte", value: rate.freeAbove }],
                  })
                  intlFallbackByCurrency[String(cur).toLowerCase()] = rate.base
                }

                /**
                 * The B2B freight tier, quote-only (#1439 follow-up).
                 *
                 * 🔴 A SEPARATE OFFER, not a re-priced retail row. The
                 * `International Shipping` option above is a RETAIL offer:
                 * `enabled_in_store: "true"`, shown in a cart, priced for a
                 * shopper buying one or two pieces. Raising it to suit a 22 kg
                 * consignment would raise it for every shopper too.
                 *
                 * So this is a second option, tiered by consignment weight,
                 * carrying `enabled_in_store: "false"` so core's rule engine
                 * keeps it out of every cart, and `quote_only: "true"` so the
                 * quote estimate can tell "deliberately not for the shop" from
                 * "the store switched this off" — which it must still refuse.
                 *
                 * ⚠️ It is the FALLBACK, not the price: `pickFreightOption`
                 * takes a live carrier rate whenever there is one. This is what
                 * stands behind the carrier, and it is the number a buyer sees
                 * only when no courier would quote the lane.
                 */
                const QUOTE_TIER_LIGHT_MAX_GRAMS = 5000
                const QUOTE_FREIGHT_TIERS = [
                  {
                    max_weight_grams: QUOTE_TIER_LIGHT_MAX_GRAMS,
                    amounts: { eur: 59, usd: 65, gbp: 52, aud: 95, cad: 88, inr: 5400 },
                  },
                  {
                    max_weight_grams: null,
                    amounts: { eur: 100, usd: 110, gbp: 88, aud: 160, cad: 150, inr: 9200 },
                  },
                ]

                const dhlEnabled = enabledIds.includes("dhl-express_dhl-express")

                await createShippingOptionsWorkflow(container).run({
                  input: [
                    {
                      name: `International Shipping (${suffix})`,
                      price_type: "flat",
                      provider_id: "manual_manual",
                      service_zone_id: intlZone.id,
                      shipping_profile_id: profileId,
                      type: {
                        label: "International",
                        description: "International shipping (self-managed / manual)",
                        code: `international-standard-${suffix}`,
                      },
                      prices: intlPrices,
                      rules: [
                        { attribute: "enabled_in_store", value: "true", operator: "eq" },
                        { attribute: "is_return", value: "false", operator: "eq" },
                      ],
                    },
                  ] as any,
                })

                await createShippingOptionsWorkflow(container).run({
                  input: [
                    {
                      name: `Quote Freight — tiered (${suffix})`,
                      price_type: "flat",
                      provider_id: "manual_manual",
                      service_zone_id: intlZone.id,
                      shipping_profile_id: profileId,
                      type: {
                        label: "Quote freight",
                        description:
                          "B2B freight by consignment weight — quotes only, never shown in a cart",
                        code: `quote-freight-tiered-${suffix}`,
                      },
                      /**
                       * Priced from `data`, not from these rows — Medusa price
                       * rules have no `weight` in their context and the
                       * estimate has no cart to build one from. It computes
                       * `total_weight_grams` for the carrier call anyway, so
                       * the consignment weight is known there and nowhere else.
                       *
                       * A price row is still required for the option to exist
                       * at all; the LIGHT tier is used so a misconfiguration
                       * fails toward the smaller number rather than silently
                       * charging a pallet rate for a parcel.
                       */
                      data: { quote_weight_tiers: QUOTE_FREIGHT_TIERS },
                      // ⚠️ `intlCurrencies` is a Set — every other use here is
                      // `for…of`, which hides that. Jest cannot see it either;
                      // the prod-build gate caught it.
                      prices: Array.from(intlCurrencies).map((cur) => ({
                        currency_code: cur,
                        amount:
                          (QUOTE_FREIGHT_TIERS[0].amounts as any)[cur] ??
                          (QUOTE_FREIGHT_TIERS[0].amounts as any)["usd"],
                      })),
                      rules: [
                        // 🔴 FALSE, deliberately — see the block above.
                        { attribute: "enabled_in_store", value: "false", operator: "eq" },
                        { attribute: "is_return", value: "false", operator: "eq" },
                        { attribute: "quote_only", value: "true", operator: "eq" },
                      ],
                    },
                  ] as any,
                })

                if (dhlEnabled) {
                  await createShippingOptionsWorkflow(container).run({
                    input: [
                      {
                        name: `DHL Express Worldwide (${suffix})`,
                        price_type: "calculated",
                        provider_id: "dhl-express_dhl-express",
                        service_zone_id: intlZone.id,
                        shipping_profile_id: profileId,
                        type: {
                          label: "DHL Express",
                          description: "DHL Express Worldwide — live rates",
                          code: `dhl-express-worldwide-${suffix}`,
                        },
                        data: { product_code: "P" },
                        rules: [
                          { attribute: "enabled_in_store", value: "true", operator: "eq" },
                          { attribute: "is_return", value: "false", operator: "eq" },
                        ],
                      },
                    ] as any,
                  })
                }

                // Shiprocket cross-border, for IN-origin stores (#1417).
                //
                // 🔑 For an Indian origin, Shiprocket IS the cross-border rate
                // source — Delhivery's cross-border product ("Starfleet") has no
                // rate API at all, and DHL only appears when its own carrier is
                // enabled. Without this the international zone offered an IN
                // store nothing but the hand-set manual placeholder.
                //
                // The client already branches to `/international/courier/serviceability`
                // on the destination country, and `calculatePrice` now passes that
                // country through — before #1417 it did not, so this option would
                // have quoted every foreign cart via the India-only endpoint and
                // been answered with an empty courier list.
                if (
                  countryLower === "in" &&
                  enabledIds.includes("shiprocket_shiprocket")
                ) {
                  await createShippingOptionsWorkflow(container).run({
                    input: [
                      {
                        name: `International Shipping (Shiprocket) (${suffix})`,
                        price_type: "calculated",
                        provider_id: "shiprocket_shiprocket",
                        service_zone_id: intlZone.id,
                        shipping_profile_id: profileId,
                        // What this option charges when Shiprocket will not
                        // quote the lane — per CURRENCY, because the amount is
                        // returned in the cart's currency and one number cannot
                        // serve both €35 and ₹3200. See the map's definition.
                        data: {
                          flat_fallback_amounts: intlFallbackByCurrency,
                        },
                        type: {
                          label: "International",
                          description: "Cross-border delivery via Shiprocket — live rates",
                          code: `shiprocket-international-${suffix}`,
                        },
                        rules: [
                          { attribute: "enabled_in_store", value: "true", operator: "eq" },
                          { attribute: "is_return", value: "false", operator: "eq" },
                        ],
                      },
                    ] as any,
                  })
                }

                console.log(
                  `[create-store] Created International zone (${intlCountries.size} countries) ` +
                    `+ manual${dhlEnabled ? " + DHL" : ""}${
                      countryLower === "in" &&
                      enabledIds.includes("shiprocket_shiprocket")
                        ? " + Shiprocket"
                        : ""
                    } option(s)`
                )
              }
            } catch (intlErr: any) {
              console.error(
                `[create-store] Failed to create international shipping: ${intlErr.message}`
              )
            }
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

// Step: link region to partner for partner-scoped region queries
const linkPartnerToRegionStep = createStep(
  "link-partner-to-region-step",
  async (
    input: { partner_id: string; region_id: string },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.create({
      [PARTNER_MODULE]: { partner_id: input.partner_id },
      [Modules.REGION]: { region_id: input.region_id },
    })
    return new StepResponse({ partner_id: input.partner_id, region_id: input.region_id })
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

    // Link region to partner for partner-scoped region queries
    linkPartnerToRegionStep({ partner_id: input.partner_id, region_id: region.id })

    return new WorkflowResponse({
      store,
      region,
      sales_channel: salesChannel,
      location,
      api_key: apiKey,
    } as CreateStoreWithDefaultsResult)
  }
)
