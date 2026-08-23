import { Modules, ProductStatus } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"

export const TEST_PARTNER_PASSWORD = "supersecret"
export const QUOTE_FIXTURE_CURRENCY = "inr"

/** Flat freight for the whole consignment, in the smallest unit. */
export const FLAT_FREIGHT_AMOUNT = 15000

/**
 * What `create-store-with-defaults` ALSO puts on an Indian store's lane, which
 * the fixture does not own and cannot suppress (#1447).
 *
 * 🔴 `RETURN` is the one that mattered: a flat "Return Shipping" option, priced
 * deliberately below the outbound base, carrying an option-level rule
 * `is_return = true`. The estimate read PRICE rules and never OPTION rules, so
 * it was offered as ordinary freight — and the picker sorts on the raw amount,
 * so it won every domestic Indian lane. Quotes were being freighted at the
 * return-pickup rate.
 *
 * `STANDARD` is the legitimate cheapest offer on this lane once the return row
 * is gone, which is why the fixture's own 15,000 does not win: provisioning
 * creates real options, and the cheapest genuine one is the honest answer.
 *
 * Mirrors the `pricingByRegion` table in `create-store-with-defaults.ts`. If
 * that changes, this fails loudly rather than silently asserting the wrong
 * number.
 */
export const PROVISIONED_STANDARD_FREIGHT_INR = 200
export const PROVISIONED_RETURN_FREIGHT_INR = 100

export const VARIANT_A_PRICE = 35000
/**
 * The volume tier on variant A, and the quantity it starts at.
 *
 * 🔑 Without a tier this whole suite would prove nothing: the mint freezes the
 * LIVE price, so on a flat-priced product the minted list would carry the same
 * amount as the base price and every "did the quote apply?" assertion would
 * pass whether the price list existed or not. The tier is what makes the
 * quoted price distinguishable from the walk-up price.
 */
export const VARIANT_A_TIER_PRICE = 28000
export const VARIANT_A_TIER_MIN_QTY = 20
export const VARIANT_B_PRICE = 42000
export const VARIANT_A_WEIGHT = 400
export const VARIANT_B_WEIGHT = 450

/**
 * The world a B2B quote needs, built through the same routes a partner uses.
 *
 * ## Why the shipping option is seeded here rather than left to the store's
 * own defaults
 *
 * `/partners/stores` does provision shipping options, but its *calculated*
 * ones are created against carrier providers (`fp_delhivery_delhivery` and
 * friends) that are registered only when their credentials are present. In a
 * test environment they are not, `validateShippingOptionsForPriceCalculation`
 * throws mid-provisioning, and the store ends up with **no usable option at
 * all** — at which point `buildQuoteView` correctly refuses to price the quote
 * ("No freight option could be quoted for this lane") and every mint 400s.
 *
 * So the fixture owns its freight: one flat option on the always-registered
 * `manual_manual` provider. That also keeps the suite off the network — a test
 * whose result depends on a carrier answering is not a test.
 */
export async function setupQuoteFixture(api: any, getContainer: () => any) {
  const container = getContainer()
  const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const partnerEmail = `partner-quote-${unique}@medusa-test.com`
  const currencyCode = QUOTE_FIXTURE_CURRENCY

  // ---- Partner ------------------------------------------------------------
  await api.post("/auth/partner/emailpass/register", {
    email: partnerEmail,
    password: TEST_PARTNER_PASSWORD,
  })
  const login1 = await api.post("/auth/partner/emailpass", {
    email: partnerEmail,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = {
    Authorization: `Bearer ${login1.data.token}`,
  }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `QuoteTest ${unique}`,
      handle: `quotetest-${unique}`,
      admin: { email: partnerEmail, first_name: "Admin", last_name: "Quote" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  // Re-login: the token minted before the partner existed carries no actor.
  const login2 = await api.post("/auth/partner/emailpass", {
    email: partnerEmail,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  // ---- Store, region, location, sales channel, publishable key ------------
  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `QuoteStore ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `QuoteChannel ${unique}`, description: "Default" },
      region: {
        name: `Quote Region ${unique}`,
        currency_code: currencyCode,
        countries: ["in"],
      },
      location: {
        name: "Quote Warehouse",
        address: {
          address_1: "12 Residency Road",
          city: "Srinagar",
          province: "JK",
          postal_code: "190001",
          country_code: "IN",
        },
      },
    },
    { headers }
  )

  const storeId = storeRes.data.store.id
  const regionId = storeRes.data.region?.id
  const salesChannelId = storeRes.data.sales_channel?.id
  const locationId = storeRes.data.location?.id
  const publishableKey = storeRes.data.api_key?.token

  // The freight estimate reads the origin postal code off
  // `store.default_location_id`; without it a quote cannot be priced at all.
  if (!locationId) {
    throw new Error("Fixture: the store was provisioned without a location.")
  }

  // ---- One flat, manual shipping option on that location ------------------
  const fulfillment: any = container.resolve(Modules.FULFILLMENT)
  const link: any = container.resolve("link")

  const profiles = await fulfillment.listShippingProfiles({})
  const shippingProfile =
    profiles[0] ??
    (await fulfillment.createShippingProfiles({
      name: "Quote Default",
      type: "default",
    }))

  const fulfillmentSet = await fulfillment.createFulfillmentSets({
    name: `Quote Shipping ${unique}`,
    type: "shipping",
  })
  const serviceZone = await fulfillment.createServiceZones({
    name: `India ${unique}`,
    fulfillment_set_id: fulfillmentSet.id,
    geo_zones: [{ type: "country", country_code: "in" }],
  })

  await link
    .create({
      [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
    })
    .catch(() => {})
  await link
    .create({
      [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
    })
    .catch(() => {})

  const { result: shippingOptions } = await createShippingOptionsWorkflow(
    container
  ).run({
    input: [
      {
        name: `Quote Flat Freight ${unique}`,
        service_zone_id: serviceZone.id,
        shipping_profile_id: shippingProfile.id,
        provider_id: "manual_manual",
        type: { label: "Flat", description: "Flat freight", code: "flat" },
        price_type: "flat",
        prices: [{ amount: FLAT_FREIGHT_AMOUNT, currency_code: currencyCode }],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      } as any,
    ],
  })
  const shippingOptionId = (shippingOptions as any[])[0]?.id

  // ---- Payment: the auto-authorizing system provider ----------------------
  await link
    .create({
      [Modules.REGION]: { region_id: regionId },
      [Modules.PAYMENT]: { payment_provider_id: "pp_system_default" },
    })
    .catch(() => {})

  // ---- One weighted, priced product --------------------------------------
  const productRes = await api.post(
    "/partners/products",
    {
      store_id: storeId,
      product: {
        title: `Unique Pashmina ${unique}`,
        handle: `unique-pashmina-${unique}`,
        status: ProductStatus.PUBLISHED,
        weight: VARIANT_A_WEIGHT,
        options: [{ title: "Weave", values: ["Twill", "Diamond"] }],
        variants: [
          {
            title: "Twill",
            sku: `UP-TWL-${unique}`,
            options: { Weave: "Twill" },
            manage_inventory: false,
            weight: VARIANT_A_WEIGHT,
            length: 40,
            width: 30,
            height: 5,
            prices: [
              { amount: VARIANT_A_PRICE, currency_code: currencyCode },
              {
                amount: VARIANT_A_TIER_PRICE,
                currency_code: currencyCode,
                min_quantity: VARIANT_A_TIER_MIN_QTY,
              },
            ],
          },
          {
            title: "Diamond",
            sku: `UP-DIA-${unique}`,
            options: { Weave: "Diamond" },
            manage_inventory: false,
            weight: VARIANT_B_WEIGHT,
            length: 40,
            width: 30,
            height: 5,
            prices: [{ amount: VARIANT_B_PRICE, currency_code: currencyCode }],
          },
        ],
      },
    },
    { headers }
  )

  const product = productRes.data.product
  const variants: any[] = product?.variants ?? []
  if (variants.length !== 2) {
    throw new Error(
      `Fixture: expected 2 variants, got ${variants.length}. ${JSON.stringify(
        productRes.data
      ).slice(0, 400)}`
    )
  }

  // The storefront only sees products in its sales channel.
  await link
    .create({
      [Modules.PRODUCT]: { product_id: product.id },
      [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId },
    })
    .catch(() => {})

  return {
    unique,
    headers,
    partnerId,
    partnerEmail,
    storeId,
    regionId,
    salesChannelId,
    locationId,
    publishableKey,
    shippingOptionId,
    currencyCode,
    productId: product.id,
    variantA: variants.find((v) => v.sku?.includes("TWL")) ?? variants[0],
    variantB: variants.find((v) => v.sku?.includes("DIA")) ?? variants[1],
  }
}

export type QuoteFixture = Awaited<ReturnType<typeof setupQuoteFixture>>

/** The mint payload the partner UI sends, with per-test overrides. */
export const mintBody = (
  fixture: QuoteFixture,
  overrides: Record<string, any> = {}
) => ({
  buyer_email: `buyer-${fixture.unique}@jaalyantra.test`,
  recipient_name: "Test Buyer",
  recipient_company: "Test Buyer Pvt Ltd",
  lines: [
    { variant_id: fixture.variantA.id, quantity: 25 },
    { variant_id: fixture.variantB.id, quantity: 4 },
  ],
  destination_country_code: "in",
  destination_postal_code: "400001",
  destination_city: "Mumbai",
  currency_code: fixture.currencyCode,
  region_id: fixture.regionId,
  carrier: "manual",
  ttl_days: 3,
  ...overrides,
})
