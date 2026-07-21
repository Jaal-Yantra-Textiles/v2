import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import { ensureOrderFulfillment } from "../../apps/backend/src/workflows/orders/fulfillment-context"
import Scrypt from "scrypt-kdf"
import * as fs from "fs"
import * as path from "path"

const E2E_AWB = "E2EAWB1234567"

/**
 * #1118 — seed a retail order whose fulfillment carries a Shiprocket shipment
 * blob, so the order-detail "Shipping & Tracking" widget can be exercised in
 * CI (the browser heavy-lifting Playwright does headlessly). Reuses the demo
 * commerce infra (region / sales channel / manual shipping option / product)
 * created by `src/scripts/seed.ts`, which the e2e:seed step runs first. Mirrors
 * the plain-fulfillment path in `workflows/orders/fulfillment-context.ts`, then
 * stamps the carrier refs the real Shiprocket flow persists onto
 * `fulfillment.data` (#1116 courier_rate, #1117 tracking_events).
 */
async function seedShipmentTrackingOrder(container: any): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code", "countries.iso_2"],
  })
  const region = regions?.[0]
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id"],
  })
  const salesChannelId = channels?.[0]?.id
  if (!region || !salesChannelId) {
    throw new Error(
      "E2E seed: no region/sales channel found. Run the demo seed first: `medusa exec ./src/scripts/seed.ts`."
    )
  }
  const countryCode = region.countries?.[0]?.iso_2 || "gb"

  // Create the order via the order module directly rather than
  // createOrderWorkflow: the workflow runs an update-order-tax-lines step that
  // resolves a tax provider for the region, which is unconfigured on a fresh CI
  // DB ("tax provider with id: null"). A fixture order needs no tax lines, and
  // the fulfillment still goes through the proper workflow below.
  const orderModule: any = container.resolve(Modules.ORDER)
  const created: any = await orderModule.createOrders({
    status: "pending",
    region_id: region.id,
    currency_code: region.currency_code,
    sales_channel_id: salesChannelId,
    email: "e2e-buyer@jyt.test",
    shipping_address: {
      first_name: "Elena",
      last_name: "Doe",
      address_1: "9 Buyer Rd",
      city: "London",
      postal_code: "EC1A 1BB",
      country_code: countryCode,
      phone: "8887776665",
    },
    // Title-only line item (no variant) — same shape as design-order converts,
    // which avoids inventory lookups and still fulfills via the manual path.
    items: [{ title: "Tangaliya Stole (e2e)", quantity: 1, unit_price: 1500 }],
    metadata: { source: "e2e-shipment-tracking" },
  })
  const order = Array.isArray(created) ? created[0] : created

  // Line-item ids for the fulfillment (read back — createOrders' return shape
  // for nested items isn't relied upon).
  const { data: withItems } = await query.graph({
    entity: "order",
    fields: ["id", "items.id"],
    filters: { id: order.id },
  })
  const itemId = withItems?.[0]?.items?.[0]?.id
  if (!itemId) throw new Error("E2E seed: order line item not created")

  // Resolve a manual shipping option (with a stock location) for the plain
  // fulfillment — identical selection to resolvePlainFulfillmentContext.
  const { data: opts } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "provider_id", "service_zone.fulfillment_set.location.id"],
  })
  const isManual = (o: any) =>
    typeof o?.provider_id === "string" && o.provider_id.startsWith("manual")
  const manual =
    (opts || []).find(
      (o: any) => isManual(o) && o.service_zone?.fulfillment_set?.location?.id
    ) || (opts || []).find(isManual)
  if (!manual) {
    throw new Error(
      "E2E seed: no manual shipping option found. Run the demo seed first."
    )
  }

  await createOrderFulfillmentWorkflow(container).run({
    input: {
      order_id: order.id,
      items: [{ id: itemId, quantity: 1 }],
      shipping_option_id: manual.id,
      location_id: manual.service_zone?.fulfillment_set?.location?.id,
      no_notification: true,
    } as any,
  })

  const { data: refetched } = await query.graph({
    entity: "order",
    fields: ["fulfillments.id"],
    filters: { id: order.id },
  })
  const fulfillmentId = refetched?.[0]?.fulfillments?.[0]?.id
  if (!fulfillmentId) throw new Error("E2E seed: fulfillment not created")

  const now = new Date().toISOString()
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
  await fulfillmentModule.updateFulfillment(fulfillmentId, {
    data: {
      carrier: "shiprocket",
      waybill: E2E_AWB,
      tracking_number: E2E_AWB,
      tracking_url: `https://shiprocket.co/tracking/${E2E_AWB}`,
      label_url: "https://sr-core-cdn.shiprocket.in/label/e2e.pdf",
      current_status: "In Transit",
      shipment_id: 999001,
      sr_order_id: 999002,
      provider_refs: {
        shipment_id: 999001,
        sr_order_id: 999002,
        courier_name: "Xpressbees Surface",
        // #1116 S3 — auto-selected international courier's quoted rate.
        courier_rate: 845.5,
        courier_rate_currency: "INR",
        international: true,
      },
      // #1117 — carrier webhook scan history (oldest first).
      tracking_events: [
        { at: null, received_at: now, status: "Pickup Scheduled", status_code: 42, location: "Surendranagar" },
        { at: null, received_at: now, status: "In Transit", status_code: 18, location: "Ahmedabad Hub" },
      ],
    },
    labels: [
      {
        tracking_number: E2E_AWB,
        tracking_url: `https://shiprocket.co/tracking/${E2E_AWB}`,
        label_url: "https://sr-core-cdn.shiprocket.in/label/e2e.pdf",
      },
    ],
  })

  return order.id
}

/**
 * #1112 — seed a design-LESS product that has been sold and fulfilled, so the
 * admin product-detail "Production Runs" section (in the Linked Designs widget)
 * can be eyeballed in CI. Fulfilling emits `order.fulfillment_created`, whose
 * subscriber retroactively mints a COMPLETED product-only run (design_id null)
 * hung off the product spine. Returns the product id.
 */
async function seedProvenanceProductRun(container: any): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModule: any = container.resolve(Modules.PRODUCT)
  const orderModule: any = container.resolve(Modules.ORDER)

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code"],
  })
  const region = regions?.[0]
  if (!region) {
    throw new Error(
      "E2E seed: no region found. Run the demo seed first: `medusa exec ./src/scripts/seed.ts`."
    )
  }

  const product = await productModule.createProducts({
    title: "Retail Provenance Stole (e2e)",
    status: "published",
    handle: `e2e-provenance-${Date.now()}`,
    options: [{ title: "Default", values: ["Default"] }],
  })

  const created: any = await orderModule.createOrders({
    status: "pending",
    region_id: region.id,
    currency_code: region.currency_code || "usd",
    email: "e2e-provenance@jyt.test",
    // Title-only line item carrying product_id (no variant → no inventory), so
    // the manual fulfillment path works and the run is hung off the product.
    items: [
      {
        title: "Retail Provenance Stole (e2e)",
        quantity: 3,
        unit_price: 2500,
        product_id: product.id,
      },
    ],
    metadata: { source: "e2e-provenance" },
  })
  const order = Array.isArray(created) ? created[0] : created

  await ensureOrderFulfillment(container, order.id)

  // The subscriber mints the run async on the emitted event — poll for it so
  // the seed file only advertises the product once its run exists.
  let minted = false
  for (let i = 0; i < 40; i++) {
    const { data: runs } = await query.graph({
      entity: "production_runs",
      fields: ["id", "design_id", "status"],
      filters: { product_id: product.id },
    })
    if ((runs || []).length) {
      minted = true
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!minted) {
    throw new Error("E2E seed: product-only production run was not minted")
  }

  return product.id
}

const SEED_PASSWORD = "e2etest123!"
const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

export default async function e2eSeed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const userModule = container.resolve(Modules.USER)
  const authModule = container.resolve(Modules.AUTH)
  const websiteService = container.resolve("websites")
  const socials: any = container.resolve("socials")

  logger.info("E2E seed: creating admin user...")

  const email = `e2e-${Date.now()}@jyt.test`
  const user = await userModule.createUsers({
    first_name: "E2E",
    last_name: "Admin",
    email,
  })

  const hashConfig = { logN: 15, r: 8, p: 1 }
  const passwordHash = await Scrypt.kdf(SEED_PASSWORD, hashConfig)

  await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: email,
        provider_metadata: {
          password: passwordHash.toString("base64"),
        },
      },
    ],
    app_metadata: {
      user_id: user.id,
    },
  })

  logger.info("E2E seed: creating website with GSC data...")

  const domain = `e2e-gsc-${Date.now()}.jyt.test`
  const website = await websiteService.createWebsites({
    domain,
    name: "E2E GSC Test",
    status: "Active",
    primary_language: "en",
  })

  const platformId = `e2e-platform-${Date.now()}`
  await socials.createSocialPlatforms({
    id: platformId,
    name: "E2E Google Platform",
    category: "google",
    auth_type: "oauth2",
    status: "active",
    api_config: { test: true },
  })

  await socials.createSocialPlatformBindings({
    platform_id: platformId,
    service: "search-console",
    resource_id: `sc-domain:${domain}`,
    resource_label: domain,
    status: "active",
  })

  const bindingsResult = await socials.listSocialPlatformBindings({
    service: "search-console",
    platform_id: platformId,
  })
  const bindings = bindingsResult.data ?? bindingsResult
  const binding = Array.isArray(bindings) ? bindings[0] : null
  if (!binding) throw new Error("No binding found after creation")

  const siteResult = await socials.createGoogleSearchConsoleSites({
    site_url: `sc-domain:${domain}`,
    platform_id: platformId,
    binding_id: binding.id,
    sync_status: "synced",
    permission_level: "siteOwner",
    last_synced_at: new Date(),
  })
  const site = Array.isArray(siteResult) ? siteResult[0] : siteResult.data?.[0] ?? siteResult
  if (!site?.id) throw new Error("No site created")

  const rows: any[] = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split("T")[0]
    rows.push(
      { site_id: site.id, date: dateStr, query: "winter dress", page: "https://example.com/dress", clicks: 10, impressions: 100, ctr: 0.1, position: 4.2, synced_at: new Date() },
      { site_id: site.id, date: dateStr, query: "summer top", page: "https://example.com/top", clicks: 5, impressions: 80, ctr: 0.0625, position: 6.1, synced_at: new Date() },
      { site_id: site.id, date: dateStr, query: "summer top", page: "https://example.com/collections/summer", clicks: 3, impressions: 40, ctr: 0.075, position: 5.5, synced_at: new Date() }
    )
  }
  await socials.createGoogleSearchConsoleInsights(rows)

  logger.info("E2E seed: creating retail order with Shiprocket shipment (#1118)...")
  const shipmentOrderId = await seedShipmentTrackingOrder(container)

  logger.info("E2E seed: creating design-less product + fulfilled order → product-only run (#1112)...")
  const provenanceProductId = await seedProvenanceProductRun(container)

  const seedData = {
    email,
    password: SEED_PASSWORD,
    websiteId: website.id,
    domain,
    shipmentOrderId,
    provenanceProductId,
  }

  fs.writeFileSync(SEED_FILE, JSON.stringify(seedData, null, 2))
  logger.info(`E2E seed complete. Credentials saved to ${SEED_FILE}`)
}
