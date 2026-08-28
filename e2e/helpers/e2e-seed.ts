import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import { ensureOrderFulfillment } from "../../apps/backend/src/workflows/orders/fulfillment-context"
import { PARTNER_QUOTE_MODULE } from "../../apps/backend/src/modules/partner-quote"
import { PAYMENT_SCHEDULE_MODULE } from "../../apps/backend/src/modules/payment_schedule"
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
 * A product that would FAIL an international label: a real variant with no
 * HS/HSN code at any of the three levels a label reads (variant → the variant's
 * inventory item → the product).
 *
 * The existing gate fixture can't cover this. Its line item is title-only with
 * no variant at all, so it can only ever exercise the `metadata.hsn` fallback —
 * the catalogue chain is invisible to it. This one has a variant precisely so
 * specs can write a code at each level and watch the resolution change.
 *
 * `manage_inventory: false` is deliberate and load-bearing: it is the case the
 * placement rule cares about, where the correct target is the PRODUCT top level
 * rather than the variant.
 */
async function seedHsCodeGapProduct(container: any): Promise<{
  productId: string
  variantId: string
}> {
  const productModule: any = container.resolve(Modules.PRODUCT)

  const product = await productModule.createProducts({
    title: "Kutch Mirror-Work Stole (e2e HSN gap)",
    status: "published",
    handle: `e2e-hsn-gap-${Date.now()}`,
    // Enough context for an LLM to classify the goods — the tooling is
    // explicitly forbidden from guessing a code off an id or SKU.
    description:
      "Hand-woven cotton stole with traditional Kutch mirror embroidery, 70x200cm.",
    material: "Cotton",
    // No hs_code at ANY level — that's the whole fixture.
    options: [{ title: "Size", values: ["One Size"] }],
    variants: [
      {
        title: "One Size",
        sku: `E2E-HSN-${Date.now()}`,
        manage_inventory: false,
        options: { Size: "One Size" },
      },
    ],
  })
  const created = Array.isArray(product) ? product[0] : product

  const variantId = created?.variants?.[0]?.id
  if (!variantId) {
    throw new Error("E2E seed: HSN gap product variant not created")
  }
  if (created.hs_code || created.variants[0].hs_code) {
    // If this ever trips, something upstream is defaulting a code and the specs
    // would be asserting against a gap that no longer exists.
    throw new Error("E2E seed: HSN gap fixture unexpectedly has an hs_code")
  }

  return { productId: created.id, variantId }
}

/**
 * A `partner_fee` for the gate order, carrying BOTH deductions — the platform
 * commission and a recorded platform-shipping charge — so the partner-UI payout
 * block has something real to render.
 *
 * The gate order is built with `orderModule.createOrders`, which never emits
 * `order.placed`, so the accrual subscriber doesn't run and no fee exists. That
 * is deliberate (the fixture must stay inert), so the fee is written directly.
 *
 * The numbers are chosen so a wrong calculation is obvious rather than
 * coincidental: 1500 − 45 − 120 = 1335, and no pair of them sums to another.
 */
async function seedPartnerFeeForGateOrder(
  container: any,
  orderId: string,
  partnerId: string,
  currencyCode: string
): Promise<{ orderTotal: number; commission: number; shipping: number; net: number }> {
  const billing: any = container.resolve("partner_billing")

  await billing.createPartnerFees([
    {
      partner_id: partnerId,
      order_id: orderId,
      order_total: 1500,
      currency_code: currencyCode,
      fee_basis: "percentage",
      fee_rate: 300, // 3.00%
      fee_amount: 45,
      status: "accrued",
      accrued_at: new Date(),
      // Partner used OUR carrier account — the second deduction.
      shipping_amount: 120,
      shipping_currency_code: currencyCode,
      shipping_carrier: "shiprocket",
      metadata: { source: "e2e-payout-summary" },
    },
  ])

  return { orderTotal: 1500, commission: 45, shipping: 120, net: 1335 }
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

/**
 * #1439 S3/S4 — two quotes on one partner, so the admin quote surface can be
 * driven in a browser (#1463 shipped without ever having been).
 *
 * Written straight through the module service rather than by driving a real
 * mint: the mint needs a partner store with a priced product and a quotable
 * freight lane, and the fixture only needs the END state the surface renders.
 * The mint path itself is covered against a real container by
 * `integration-tests/http/partner-quote-mint.spec.ts`.
 *
 * 🔑 TWO quotes, and the second is `superseded` on purpose. Active-only
 * fixtures would let the surface treat every dead quote as a revocation, and
 * "the partner withdrew this offer" is a different and wrong story to tell an
 * operator about a quote that was simply re-issued (#1435).
 *
 * `token_hash` is random rather than a hash of a known token: the raw token is
 * never persisted, and a fixture that pretended otherwise would model a
 * recoverable link, which is exactly what the detail page states cannot exist.
 */
async function seedAdminQuotes(container: any): Promise<{
  partnerId: string
  partnerName: string
  activeQuoteId: string
  activeQuoteCompany: string
  supersededQuoteId: string
  supersededQuoteCompany: string
  acceptedQuoteId: string
  acceptedQuoteCompany: string
  zeroDepositQuoteId: string
  zeroDepositQuoteCompany: string
}> {
  const partnerModule: any = container.resolve("partner")
  // 🔴 `partnerQuote`, camelCase — NOT `partner_quote`.
  //
  // The module registers itself as `PARTNER_QUOTE_MODULE = "partnerQuote"`
  // (`src/modules/partner-quote/index.ts`), while the directory, the table and
  // every column prefix are snake_case. Resolving the snake_case name threw
  // `Could not resolve 'partner_quote'` and took the WHOLE e2e suite red from
  // 22 Aug — the seed dies before any spec runs, so a failure here reads like
  // "the module is not registered" when it is registered in both configs.
  // Imported from the module rather than retyped, so the next rename moves it.
  const quoteService: any = container.resolve(PARTNER_QUOTE_MODULE)
  const scheduleService: any = container.resolve(PAYMENT_SCHEDULE_MODULE)

  const stamp = Date.now()

  const createdPartner = await partnerModule.createPartners({
    name: `E2E Quote Partner ${stamp}`,
    handle: `e2e-quote-${stamp}`,
    status: "active",
    is_verified: true,
  })
  const partner = Array.isArray(createdPartner) ? createdPartner[0] : createdPartner

  // Stamped company names: the spec SEARCHES for these, and the search reaches
  // the server (#1461), so a duplicate from a previous seed would make a
  // one-row assertion flap.
  const activeCompany = `E2E Active Buyer ${stamp} Pvt Ltd`
  const supersededCompany = `E2E Superseded Buyer ${stamp} Pvt Ltd`

  const mkQuote = async (suffix: string, over: Record<string, any>) => {
    const created = await quoteService.createPartnerQuotes({
      partner_id: partner.id,
      destination_country_code: "in",
      destination_postal_code: "400001",
      destination_city: "Mumbai",
      currency_code: "inr",
      quoted_subtotal: 800000,
      quoted_freight: 15000,
      quoted_landed_total: 815000,
      quoted_weight_grams: 11800,
      quoted_at: new Date(),
      // 32 random hex chars — shaped like the sha256 the mint stores, and
      // unique because the column is.
      token_hash: `e2e${stamp}${Math.random().toString(16).slice(2)}${suffix}`,
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      ...over,
    })
    const row = Array.isArray(created) ? created[0] : created

    await quoteService.createPartnerQuoteLines([
      {
        quote_id: row.id,
        variant_id: `variant_e2e_${stamp}_${suffix}`,
        quantity: 25,
        position: 0,
        quoted_unit_amount: 28000,
        quoted_subtotal: 700000,
        quoted_unit_weight_grams: 400,
        quoted_weight_source: "variant",
      },
    ])

    return row.id as string
  }

  const activeQuoteId = await mkQuote("a", {
    recipient_name: "Priya Menon",
    recipient_company: activeCompany,
    email_sent_to: `e2e-active-${stamp}@buyer.test`,
    status: "active",
  })

  const supersededQuoteId = await mkQuote("s", {
    recipient_name: "Rahul Iyer",
    recipient_company: supersededCompany,
    email_sent_to: `e2e-superseded-${stamp}@buyer.test`,
    status: "superseded",
  })

  /**
   * #1439 S11 — the two deposit cases the UI has to tell apart, plus an
   * acceptance with a real ledger row behind it.
   *
   * 🔑 `deposit_pct: 0` is seeded ON PURPOSE and is the whole point of this
   * fixture. Null means "nobody named terms, the platform's 30% applies at
   * acceptance"; 0 means "this buyer pays nothing up front". Every `||` on the
   * path from the form to the column collapses one into the other, and the
   * collapse is silent — the partner sees the number they typed and the buyer
   * is asked for a third of the order. A spec can only catch that if a 0
   * actually exists in the data.
   */
  const acceptedCompany = `E2E Accepted Buyer ${stamp} Pvt Ltd`
  const zeroDepositCompany = `E2E Zero Deposit Buyer ${stamp} Pvt Ltd`

  const acceptedCartId = `cart_e2e_${stamp}`
  const acceptedQuoteId = await mkQuote("x", {
    recipient_name: "Anita Rao",
    recipient_company: acceptedCompany,
    email_sent_to: `e2e-accepted-${stamp}@buyer.test`,
    status: "active",
    deposit_pct: 40,
    accepted_cart_id: acceptedCartId,
    accepted_at: new Date(),
  })

  const zeroDepositQuoteId = await mkQuote("z", {
    recipient_name: "Vikram Shah",
    recipient_company: zeroDepositCompany,
    email_sent_to: `e2e-zero-${stamp}@buyer.test`,
    status: "active",
    deposit_pct: 0,
  })

  /**
   * The ledger behind the acceptance. Written through `openForCart` rather than
   * by hand so the fixture cannot disagree with the split the product uses —
   * a seeded deposit/balance pair that does not add back to the total would
   * make the panel look right while proving nothing.
   */
  await scheduleService.openForCart({
    cart_id: acceptedCartId,
    currency_code: "inr",
    total_due: 815000,
    source_type: "quote",
    source_id: acceptedQuoteId,
    rail: "payu",
    quote_deposit_pct: 40,
  })

  // One activity row, so the timeline renders its real shape rather than its
  // "no activity recorded yet" fallback — the actor badge is the thing an
  // operator reads first when a buyer challenges a price.
  await quoteService.recordEvent({
    quote_id: activeQuoteId,
    type: "minted",
    actor_type: "admin",
    message: "Quote minted on the partner's behalf.",
  })

  return {
    partnerId: partner.id as string,
    partnerName: partner.name as string,
    activeQuoteId,
    activeQuoteCompany: activeCompany,
    supersededQuoteId,
    supersededQuoteCompany: supersededCompany,
    acceptedQuoteId,
    acceptedQuoteCompany: acceptedCompany,
    zeroDepositQuoteId,
    zeroDepositQuoteCompany: zeroDepositCompany,
  }
}

/**
 * #1228 — a production run parked in `awaiting_reassignment`, plus the two
 * partners the reassign drawer picks between: the one that let it lapse
 * (`previous_partner_id`, the "same partner again" option) and a fresh one.
 *
 * Written straight through the module services rather than by driving a real
 * decline: the fixture only needs the END state, and going through the partner
 * decline route would drag the whole auth + dispatch chain into the seed.
 *
 * Mirrors exactly what `reassignProductionRunWorkflow` leaves behind — partner
 * unassigned, previous partner retained, a park reason for the drawer to show —
 * so the spec exercises the same shape production produces.
 */
async function seedParkedProductionRun(container: any): Promise<{
  runId: string
  designId: string
  lapsedPartnerId: string
  lapsedPartnerName: string
  freshPartnerName: string
}> {
  const partnerModule: any = container.resolve("partner")
  const designService: any = container.resolve("design")
  const runService: any = container.resolve("production_runs")

  const stamp = Date.now()

  const mkPartner = async (label: string) => {
    const created = await partnerModule.createPartners({
      // Stamped: the name is what the reassign picker shows and what the spec
      // selects on, so repeat seeds must not produce duplicates.
      name: `E2E ${label} Partner ${stamp}`,
      handle: `e2e-${label.toLowerCase()}-${stamp}`,
      status: "active",
      is_verified: true,
    })
    const row = Array.isArray(created) ? created[0] : created
    return { id: row.id as string, name: row.name as string }
  }

  const lapsed = await mkPartner("Lapsed")
  const fresh = await mkPartner("Fresh")

  const design = await designService.createDesigns({
    name: `Reassign Fixture (e2e ${stamp})`,
    description: "e2e #1228 manual reassignment fixture",
    design_type: "Original",
    status: "Commerce_Ready",
    priority: "Medium",
  })
  const designId = (Array.isArray(design) ? design[0] : design).id as string

  const run = await runService.createProductionRuns({
    design_id: designId,
    quantity: 3,
    run_type: "production",
    // Both non-nullable on the model; the run page reads design.name off the
    // snapshot.
    snapshot: { design: { id: designId, name: `Reassign Fixture (e2e ${stamp})` } },
    captured_at: new Date(),
    status: "awaiting_reassignment",
    partner_id: null,
    previous_partner_id: lapsed.id,
    cancelled_reason: "Declined by partner (capacity): Machine servicing",
    reminder_count: 0,
    reminder_status: "closed",
  })
  const runId = (Array.isArray(run) ? run[0] : run).id as string

  return {
    runId,
    designId,
    lapsedPartnerId: lapsed.id,
    lapsedPartnerName: lapsed.name,
    freshPartnerName: fresh.name,
  }
}

/**
 * #1556 — a partner with COMPLETED, priced production runs, so the admin
 * payment-submission screen can be driven through the runs tab.
 *
 * The fixture's whole point is the two numbers disagreeing:
 *
 *   - ordered 9, produced 4 — the screen must bill 4. Billing the ordered
 *     figure is what `runPayableAmount` still does on the auto-draft path, so a
 *     fixture where the two match cannot tell the paths apart.
 *   - a rate on the RUN (1200/unit) that disagrees with the design's own
 *     `estimated_cost` (5000). Pricing off the design would bill 45,000 for
 *     work worth 4,800, and a fixture whose design cost equals the run rate
 *     would pass whichever one the screen actually used.
 *
 * 🔑 The design is left in `Technical_Review` deliberately. That is where run
 * completion puts a design, and it is NOT one of the statuses the hand-
 * submission gate accepts — so the spec also proves the screen waives that gate
 * for run-sourced payouts rather than requiring someone to edit a design's
 * review status in order to release a payment.
 *
 * A second run of the same design is included with NO rate: it must render as
 * unpayable rather than silently billing zero or vanishing from the list.
 *
 * ⚠️ THREE runs, not two, and deliberately so. Creating a submission consumes a
 * run permanently — the run-level guard is the whole point — so a spec that
 * billed the same run it also makes read-only assertions about would pass once
 * and then fail on every re-run and on every CI RETRY. `billableRunId` is the
 * sacrificial one; `payableRunId` is never billed and stays assertable.
 */
async function seedPayableProductionRuns(container: any): Promise<{
  partnerId: string
  partnerName: string
  partnerEmail: string
  designId: string
  designName: string
  payableRunId: string
  billableRunId: string
  unpricedRunId: string
  partnerBillableRunId: string
  partnerBillableDesignName: string
  partnerSumRunAId: string
  partnerSumRunBId: string
  sumDesignName: string
}> {
  const partnerModule: any = container.resolve("partner")
  const designService: any = container.resolve("design")
  const runService: any = container.resolve("production_runs")
  const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
  const authModule: any = container.resolve(Modules.AUTH)

  const stamp = Date.now()

  const created = await partnerModule.createPartners({
    name: `E2E Payout Partner ${stamp}`,
    handle: `e2e-payout-${stamp}`,
    status: "active",
    is_verified: true,
  })
  const partner = Array.isArray(created) ? created[0] : created

  /**
   * The payout partner needs a real login: the #1571 B-half spec drives the
   * PARTNER UI, not the admin app, so it has to sign in as the partner who owns
   * these runs. Mirrors the gate-partner block below, including the verified
   * `auth_verification` row — without it login returns
   * `{ verification_required: true }` with an actorless token that the partner
   * UI deliberately refuses to persist, and every request 401s.
   */
  const partnerEmail = `e2e-payout-${stamp}@jyt.test`
  await partnerModule.createPartnerAdmins({
    email: partnerEmail,
    first_name: "E2E",
    last_name: "Payout",
    role: "admin",
    partner_id: partner.id,
  })
  const payoutHash = await Scrypt.kdf(SEED_PASSWORD, { logN: 15, r: 8, p: 1 })
  const payoutAuth: any = await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: partnerEmail,
        provider_metadata: { password: payoutHash.toString("base64") },
      },
    ],
    app_metadata: { partner_id: partner.id },
  })
  const payoutAuthId = Array.isArray(payoutAuth)
    ? payoutAuth[0].id
    : payoutAuth.id
  const verifiedAt = new Date()
  await authModule.createAuthVerifications([
    {
      auth_identity_id: payoutAuthId,
      entity_id: partnerEmail,
      entity_type: "email",
      code_provider: "emailpass",
      requested_at: verifiedAt,
      verified_at: verifiedAt,
    },
  ])

  const designName = `Payable Run Fixture (e2e ${stamp})`
  const design = await designService.createDesigns({
    name: designName,
    description: "e2e #1556 payable production run fixture",
    design_type: "Original",
    // Where run completion leaves a design — see the note above.
    status: "Technical_Review",
    priority: "Medium",
    // Deliberately NOT 1200: if the screen prices off the design instead of the
    // run, the amount is visibly wrong rather than coincidentally right.
    estimated_cost: 5000,
  })
  const designId = (Array.isArray(design) ? design[0] : design).id as string

  // The submission workflow validates that the design belongs to the partner
  // through this link, so the fixture is not payable without it.
  await remoteLink.create({
    design: { design_id: designId },
    partner: { partner_id: partner.id },
  })

  const mkRun = async (overrides: Record<string, any>) => {
    const run = await runService.createProductionRuns({
      design_id: designId,
      partner_id: partner.id,
      run_type: "production",
      status: "completed",
      completed_at: new Date(),
      snapshot: { design: { id: designId, name: designName } },
      captured_at: new Date(),
      ...overrides,
    })
    return (Array.isArray(run) ? run[0] : run).id as string
  }

  const payableRunId = await mkRun({
    quantity: 9,
    produced_quantity: 4,
    partner_cost_estimate: 1200,
    cost_type: "per_unit",
  })

  // Identical to `payableRunId`, and consumed by the spec that actually
  // creates a submission. See the THREE-runs note above.
  const billableRunId = await mkRun({
    quantity: 9,
    produced_quantity: 4,
    partner_cost_estimate: 1200,
    cost_type: "per_unit",
  })

  const unpricedRunId = await mkRun({
    quantity: 2,
    produced_quantity: 2,
    partner_cost_estimate: null,
  })

  /**
   * Consumed by the PARTNER-UI spec (#1571 B half). Separate from
   * `billableRunId`, which the admin spec consumes — two specs billing one run
   * would make whichever ran second fail on the double-pay guard, and that
   * failure looks exactly like a real defect.
   *
   * 🔴 On its OWN design, and a separate RUN is not enough. Step 5 of
   * `validateDesignsForSubmissionStep` refuses a DESIGN that already carries a
   * Pending submission — a guard one level coarser than the run-level one. The
   * partner spec submits before the admin spec does, so while both billable
   * runs shared this fixture's design the admin submission was refused with
   * "Designs already in an active payment submission", which names neither
   * spec and reads like a product defect. Same reasoning as the sum-run design
   * below; it was applied there and missed here.
   */
  const partnerBillableDesignName = `Partner Billable Fixture (e2e ${stamp})`
  const partnerBillableDesign = await designService.createDesigns({
    name: partnerBillableDesignName,
    description: "e2e #1571 partner-submitted payout fixture",
    design_type: "Original",
    status: "Technical_Review",
    priority: "Medium",
    estimated_cost: 5000,
  })
  const partnerBillableDesignId = (
    Array.isArray(partnerBillableDesign)
      ? partnerBillableDesign[0]
      : partnerBillableDesign
  ).id as string
  await remoteLink.create({
    design: { design_id: partnerBillableDesignId },
    partner: { partner_id: partner.id },
  })

  const partnerBillableRun = await runService.createProductionRuns({
    design_id: partnerBillableDesignId,
    partner_id: partner.id,
    run_type: "production",
    status: "completed",
    completed_at: new Date(),
    snapshot: {
      design: { id: partnerBillableDesignId, name: partnerBillableDesignName },
    },
    captured_at: new Date(),
    quantity: 9,
    produced_quantity: 4,
    partner_cost_estimate: 1200,
    cost_type: "per_unit",
  })
  const partnerBillableRunId = (
    Array.isArray(partnerBillableRun)
      ? partnerBillableRun[0]
      : partnerBillableRun
  ).id as string

  /**
   * A PAIR of priced runs on the same design, billed together in one
   * submission. A payment line is keyed by design, so both collapse into one
   * line whose quantity must be the SUM (3 + 5 = 8), not the last one seen.
   * The two produced figures differ on purpose: if the screen overwrites
   * instead of summing, the total is 5x1200 or 3x1200 rather than 8x1200, and
   * the assertion says which.
   *
   * 🔴 They sit on their OWN design, deliberately. Step 5 of
   * `validateDesignsForSubmissionStep` refuses a design that already has a
   * Pending submission ("Designs already in an active payment submission"), and
   * the submit spec creates exactly that against the main fixture design. Put
   * these two runs on it and the summing spec fails EVERY time, with a message
   * about active submissions that says nothing about summing — a fixture
   * collision wearing the costume of a product bug.
   */
  const sumDesignName = `Sum Run Fixture (e2e ${stamp})`
  const sumDesign = await designService.createDesigns({
    name: sumDesignName,
    description: "e2e #1571 two-runs-one-line fixture",
    design_type: "Original",
    status: "Technical_Review",
    priority: "Medium",
    estimated_cost: 5000,
  })
  const sumDesignId = (Array.isArray(sumDesign) ? sumDesign[0] : sumDesign)
    .id as string
  await remoteLink.create({
    design: { design_id: sumDesignId },
    partner: { partner_id: partner.id },
  })

  const mkSumRun = async (overrides: Record<string, any>) => {
    const run = await runService.createProductionRuns({
      design_id: sumDesignId,
      partner_id: partner.id,
      run_type: "production",
      status: "completed",
      completed_at: new Date(),
      snapshot: { design: { id: sumDesignId, name: sumDesignName } },
      captured_at: new Date(),
      ...overrides,
    })
    return (Array.isArray(run) ? run[0] : run).id as string
  }

  const partnerSumRunAId = await mkSumRun({
    quantity: 3,
    produced_quantity: 3,
    partner_cost_estimate: 1200,
    cost_type: "per_unit",
  })
  const partnerSumRunBId = await mkSumRun({
    quantity: 5,
    produced_quantity: 5,
    partner_cost_estimate: 1200,
    cost_type: "per_unit",
  })

  return {
    partnerId: partner.id as string,
    partnerName: partner.name as string,
    partnerEmail,
    designId,
    designName,
    payableRunId,
    billableRunId,
    unpricedRunId,
    partnerBillableRunId,
    partnerBillableDesignName,
    partnerSumRunAId,
    partnerSumRunBId,
    sumDesignName,
  }
}

/**
 * #1363 — a design with a MULTI-ITEM bill of materials and an approvable run,
 * so the per-assignment material allocation can be driven through the admin UI.
 *
 * The BOM has to have more than one item or the fixture cannot discriminate:
 * the whole defect was that a run carried EVERY item its design was linked to,
 * and a one-item design looks identical whether the feature works or not. Three
 * items means an assignment that takes one is visibly a choice.
 *
 * Two partners, because the point is that two assignments off the SAME design
 * can be sent different materials. The run is left in `pending_review` — the
 * status `approve` is allowed from — so the spec drives the real approval, not
 * a shortcut into the end state.
 */
async function seedAllocationDesignRun(container: any): Promise<{
  runId: string
  designId: string
  designName: string
  partnerAName: string
  partnerBName: string
  materialALabel: string
  materialBLabel: string
  materialCLabel: string
  materialAId: string
  materialCId: string
}> {
  const partnerModule: any = container.resolve("partner")
  const designService: any = container.resolve("design")
  const runService: any = container.resolve("production_runs")
  const inventoryService: any = container.resolve(Modules.INVENTORY)
  const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

  const stamp = Date.now()

  const mkPartner = async (label: string) => {
    const created = await partnerModule.createPartners({
      name: `E2E Alloc ${label} ${stamp}`,
      handle: `e2e-alloc-${label.toLowerCase()}-${stamp}`,
      status: "active",
      is_verified: true,
    })
    const row = Array.isArray(created) ? created[0] : created
    return { id: row.id as string, name: row.name as string }
  }

  const partnerA = await mkPartner("Weaver")
  const partnerB = await mkPartner("Finisher")

  const designName = `Allocation Fixture (e2e ${stamp})`
  const design = await designService.createDesigns({
    name: designName,
    description: "e2e #1363 per-assignment material allocation fixture",
    design_type: "Original",
    status: "Commerce_Ready",
    priority: "Medium",
    /**
     * #938 — a garment type that a MODEL supplied, not a designer.
     *
     * `product_type` and `design_type` answer different questions and the
     * fixture carries both so a spec can prove the UI does not conflate them:
     * this design is an "Original" (how original the work is) that is a
     * "stole" (what the thing is).
     *
     * 🔑 `product_type_source: "inferred"` is the load-bearing half. An
     * inferred type is provisional — it is what a human correction overwrites
     * — so it has to be badged, and a fixture where every type looked
     * designer-authored could never show that the badge appears.
     */
    product_type: "stole",
    product_type_source: "inferred",
  })
  const designId = (Array.isArray(design) ? design[0] : design).id as string

  // The bill of materials. Stamped titles because the spec selects on them and
  // a repeat seed must not produce two chips reading the same thing.
  const specs = [
    { title: `E2E Mulberry Silk ${stamp}`, planned: 40 },
    { title: `E2E Cotton Thread ${stamp}`, planned: 2 },
    { title: `E2E Lining ${stamp}`, planned: 12 },
  ]

  const items: Array<{ id: string; title: string }> = []
  for (const spec of specs) {
    const created = await inventoryService.createInventoryItems({
      title: spec.title,
      sku: `e2e-alloc-${items.length}-${stamp}`,
      requires_shipping: false,
    })
    const row = Array.isArray(created) ? created[0] : created
    items.push({ id: row.id as string, title: spec.title })
  }

  await remoteLink.create(
    items.map((item, i) => ({
      design: { design_id: designId },
      [Modules.INVENTORY]: { inventory_item_id: item.id },
      data: { planned_quantity: specs[i].planned },
    }))
  )

  const run = await runService.createProductionRuns({
    design_id: designId,
    quantity: 6,
    run_type: "production",
    // The parent snapshots the design's FULL BOM — that is what it is, the
    // design's plan. The children get narrowed to what each partner is issued.
    snapshot: {
      design: { id: designId, name: designName },
      inventory_links: items.map((item, i) => ({
        inventory_item_id: item.id,
        planned_quantity: specs[i].planned,
        inventory_item: { id: item.id, title: item.title },
      })),
    },
    captured_at: new Date(),
    status: "pending_review",
  })
  const runId = (Array.isArray(run) ? run[0] : run).id as string

  return {
    runId,
    designId,
    designName,
    partnerAName: partnerA.name,
    partnerBName: partnerB.name,
    materialALabel: specs[0].title,
    materialBLabel: specs[1].title,
    materialCLabel: specs[2].title,
    materialAId: items[0].id,
    materialCId: items[2].id,
  }
}

/**
 * #1113 — seed a design carrying a full brief (concept + aesthetic anchor +
 * persona + competitors + price point + milestones + design budget), so the
 * designer-invite → brief-moodboard flow (S1 invite/accept + S2 generate) can be
 * driven end-to-end against the live server in CI. Returns the design id.
 */
async function seedDesignerInviteDesign(container: any): Promise<string> {
  const designService: any = container.resolve("design")
  const design = await designService.createDesigns({
    name: `Designer Invite Brief (e2e)`,
    description: "e2e designer-onboarding brief",
    design_type: "Original",
    status: "Conceptual",
    priority: "Medium",
    // Brief columns (#604 / #1113 S2) → the moodboard's anchor cards.
    concept_theme: "90s Tokyo Streetwear",
    aesthetic_keywords: ["utilitarian", "sleek", "nostalgic"],
    persona: { age_range: "25-34", lifestyle: "urban minimalist", values: ["sustainability"] },
    competitors: [{ name: "Acme Knits", differentiator: "hand-loomed" }],
    price_point: "mid_market",
    design_budget: 250000,
    cost_currency: "inr",
    milestones: [
      { label: "Initial sketches", date: "2026-08-01" },
      { label: "Production-ready samples", date: null },
    ],
  })
  return design.id
}

/**
 * #1195 — an order in the exact shape that hid "Mark as shipped": a line item
 * the derivation stamps `requires_shipping: false` (title-only, so no shipping
 * profile and no inventory to vote true), fulfilled against a NON-pickup manual
 * option. The pickup rule the Medusa user guide documents is therefore NOT what
 * suppresses the action — the undocumented `requires_shipping` term is.
 *
 * Deliberately built with `orderModule.createOrders` + the fulfillment
 * workflow, NOT `createOrderWorkflow` (no tax provider on a fresh CI DB) and
 * NOT through a cart (which would emit `order.placed`, whose subscriber repairs
 * profiled items — this fixture must stay broken for the specs to mean
 * anything).
 */
export async function seedShipmentGateOrder(container: any): Promise<{
  orderId: string
  fulfillmentId: string
  currencyCode: string
}> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const orderModule: any = container.resolve(Modules.ORDER)

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
      "E2E seed: no region/sales channel found. Run the demo seed first."
    )
  }

  const created: any = await orderModule.createOrders({
    status: "pending",
    region_id: region.id,
    currency_code: region.currency_code,
    sales_channel_id: salesChannelId,
    email: "e2e-gate@jyt.test",
    shipping_address: {
      first_name: "Gate",
      last_name: "Check",
      address_1: "1 Loom St",
      city: "London",
      postal_code: "EC1A 1BB",
      country_code: region.countries?.[0]?.iso_2 || "gb",
      phone: "8887776665",
    },
    items: [
      {
        title: "Tangaliya Stole (#1195 gate)",
        quantity: 1,
        unit_price: 1500,
        // Explicit, so the fixture cannot drift if the derivation is fixed
        // upstream — the spec's whole point is this value being false.
        requires_shipping: false,
      },
    ],
    metadata: { source: "e2e-shipment-gate" },
  })
  const order = Array.isArray(created) ? created[0] : created

  const { data: withItems } = await query.graph({
    entity: "order",
    fields: ["id", "items.id"],
    filters: { id: order.id },
  })
  const itemId = withItems?.[0]?.items?.[0]?.id
  if (!itemId) throw new Error("E2E seed: gate order line item not created")

  const { data: opts } = await query.graph({
    entity: "shipping_option",
    fields: [
      "id",
      "provider_id",
      "service_zone.fulfillment_set.type",
      "service_zone.fulfillment_set.location.id",
    ],
  })
  const manual = (opts || []).find(
    (o: any) =>
      typeof o?.provider_id === "string" &&
      o.provider_id.startsWith("manual") &&
      o.service_zone?.fulfillment_set?.location?.id &&
      o.service_zone?.fulfillment_set?.type !== "pickup"
  )
  if (!manual) {
    throw new Error(
      "E2E seed: no manual NON-pickup shipping option found. Run the demo seed first."
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
    fields: ["fulfillments.id", "fulfillments.requires_shipping"],
    filters: { id: order.id },
  })
  const fulfillment = refetched?.[0]?.fulfillments?.[0]
  if (!fulfillment?.id) {
    throw new Error("E2E seed: gate fulfillment not created")
  }
  if (fulfillment.requires_shipping !== false) {
    // If this ever trips, upstream changed the derivation — the specs that use
    // this fixture are asserting a bug that no longer exists. Fail loudly here
    // rather than let them pass for the wrong reason.
    throw new Error(
      `E2E seed: gate fulfillment expected requires_shipping=false, got ${fulfillment.requires_shipping}`
    )
  }

  return {
    orderId: order.id,
    fulfillmentId: fulfillment.id,
    currencyCode: region.currency_code,
  }
}

/**
 * #1195 — a partner that can open the gate order in the partner-UI. Mirrors the
 * admin identity seeding above (Scrypt-hashed emailpass identity), then links
 * the store and the order.
 *
 * The store link is NOT optional: without one the partner order-detail route
 * requests `/partners/stores/undefined/locations/<id>` and error-boundaries the
 * whole page into a 400, so the fulfillment section never renders.
 */
export async function seedShipmentGatePartner(
  container: any,
  orderId: string
): Promise<{ email: string; password: string; partnerId: string }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const authModule = container.resolve(Modules.AUTH)
  const link: any = container.resolve(ContainerRegistrationKeys.LINK)
  const partnerModule: any = container.resolve("partner")

  const email = `e2e-partner-gate-${Date.now()}@jyt.test`
  const partner = await partnerModule.createPartners({
    name: "E2E Gate Partner",
    handle: `e2e-gate-${Date.now()}`,
    // Active + verified, else the app parks the session on /onboarding.
    status: "active",
    is_verified: true,
  })
  const partnerId = Array.isArray(partner) ? partner[0].id : partner.id

  await partnerModule.createPartnerAdmins({
    email,
    first_name: "E2E",
    last_name: "Partner",
    role: "admin",
    partner_id: partnerId,
  })

  const hashConfig = { logN: 15, r: 8, p: 1 }
  const passwordHash = await Scrypt.kdf(SEED_PASSWORD, hashConfig)
  const authIdentity: any = await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: email,
        provider_metadata: { password: passwordHash.toString("base64") },
      },
    ],
    app_metadata: { partner_id: partnerId },
  })
  const authIdentityId = Array.isArray(authIdentity)
    ? authIdentity[0].id
    : authIdentity.id

  // PARTNER_EMAIL_VERIFICATION: without a VERIFIED auth_verification row the
  // login returns `{ verification_required: true }` with an actorless token,
  // and the partner UI deliberately does not persist that token — so the seeded
  // partner would appear to log in and then 401 on every request. Same row the
  // `backfill-partner-email-verified` DP job writes.
  const now = new Date()
  await authModule.createAuthVerifications([
    {
      auth_identity_id: authIdentityId,
      entity_id: email,
      entity_type: "email",
      code_provider: "emailpass",
      requested_at: now,
      verified_at: now,
    },
  ])

  // A DEDICATED store, not the demo one: the partner↔store link is one store
  // per partner (`defineLink(partner, { store, isList: true })`), so reusing an
  // already-linked store throws "Cannot create multiple links between 'partner'
  // and 'store'" the second time the seed runs.
  const storeModule: any = container.resolve(Modules.STORE)
  const createdStore: any = await storeModule.createStores({
    name: `E2E Gate Store ${Date.now()}`,
  })
  const storeId = Array.isArray(createdStore)
    ? createdStore[0].id
    : createdStore.id

  await link.create({
    partner: { partner_id: partnerId },
    store: { store_id: storeId },
  })
  await link.create({
    partner: { partner_id: partnerId },
    order: { order_id: orderId },
  })

  // Password returned explicitly rather than letting the spec reuse the admin
  // `password` field — they happen to be the same constant today, and a spec
  // that silently depends on that fails with "Invalid email or password".
  return { email, password: SEED_PASSWORD, partnerId }
}

/**
 * Seed a partner + website + page + blocks for the visual block editor e2e spec.
 * Mirrors seedShipmentGatePartner for auth, then creates a website with a page
 * containing a Hero block and a Feature block so the editor has content to render.
 */
async function seedContentEditorPartner(
  container: any
): Promise<{
  email: string
  password: string
  partnerId: string
  pageId: string
  websiteId: string
}> {
  const authModule = container.resolve(Modules.AUTH)
  const link: any = container.resolve(ContainerRegistrationKeys.LINK)
  const partnerModule: any = container.resolve("partner")
  const websiteService = container.resolve("websites")
  const storeModule: any = container.resolve(Modules.STORE)

  const email = `e2e-content-${Date.now()}@jyt.test`

  // Partner
  const partner = await partnerModule.createPartners({
    name: "E2E Content Partner",
    handle: `e2e-content-${Date.now()}`,
    status: "active",
    is_verified: true,
  })
  const partnerId = Array.isArray(partner) ? partner[0].id : partner.id

  await partnerModule.createPartnerAdmins({
    email,
    first_name: "Content",
    last_name: "Editor",
    role: "admin",
    partner_id: partnerId,
  })

  // Auth identity + verification
  const hashConfig = { logN: 15, r: 8, p: 1 }
  const passwordHash = await Scrypt.kdf(SEED_PASSWORD, hashConfig)
  const authIdentity: any = await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: email,
        provider_metadata: { password: passwordHash.toString("base64") },
      },
    ],
    app_metadata: { partner_id: partnerId },
  })
  const authIdentityId = Array.isArray(authIdentity)
    ? authIdentity[0].id
    : authIdentity.id

  const now = new Date()
  await authModule.createAuthVerifications([
    {
      auth_identity_id: authIdentityId,
      entity_id: email,
      entity_type: "email",
      code_provider: "emailpass",
      requested_at: now,
      verified_at: now,
    },
  ])

  // Store
  const createdStore: any = await storeModule.createStores({
    name: `E2E Content Store ${Date.now()}`,
  })
  const storeId = Array.isArray(createdStore)
    ? createdStore[0].id
    : createdStore.id
  await link.create({
    partner: { partner_id: partnerId },
    store: { store_id: storeId },
  })

  // Website
  const domain = `e2e-content-${Date.now()}.jyt.test`
  const website = await websiteService.createWebsites({
    domain,
    name: "E2E Content Website",
    status: "Active",
    primary_language: "en",
  })

  // Link partner to website
  await partnerModule.updatePartners({
    id: partnerId,
    storefront_domain: domain,
    website_id: website.id,
  })

  // Page
  const pageService = container.resolve("websites")
  const page = await pageService.createPages({
    website_id: website.id,
    title: "E2E Content Page",
    slug: "e2e-content-page",
    content: "Test content for visual editor",
    page_type: "Custom",
    status: "Published",
    last_modified: new Date(),
  })

  // Seed blocks: one Hero (unique) + one Feature (repeatable)
  await websiteService.createBlocks({
    page_id: page.id,
    name: "Hero Section",
    type: "Hero",
    content: { title: "Welcome to our store", subtitle: "Handcrafted textiles" },
    settings: { backgroundColor: "#f5f5f5", padding: "40", max_width: "wide" },
    status: "Active",
    order: 0,
  })
  await websiteService.createBlocks({
    page_id: page.id,
    name: "Feature Highlight",
    type: "Feature",
    content: { title: "Natural fibers", description: "100% organic cotton" },
    settings: {},
    status: "Active",
    order: 1,
  })

  return { email, password: SEED_PASSWORD, partnerId, pageId: page.id, websiteId: website.id }
}

/**
 * One CRM contact with a prior inbound activity, for the contact-detail spec.
 *
 * The CRM lives on a Hyperbee node, not Postgres — the e2e run uses the
 * EMBEDDED store (`CRM_HYPERBEE=true`), so this writes through the module
 * service exactly as the admin route does. If the module is disabled the
 * resolve throws, which is the honest failure: a CRM spec against no CRM would
 * otherwise "pass" by finding nothing.
 *
 * The activity matters as much as the person. An empty timeline renders the
 * same empty-state whether the section works or not, so the spec needs at least
 * one row it can point at.
 */
async function seedCrmContact(container: any): Promise<{
  personId: string
  personName: string
  activityBody: string
}> {
  const crm: any = container.resolve("crm")

  const first = "Noor"
  const last = `Weaver-${Date.now()}`
  const person = await crm.createCrmPeople({
    first_name: first,
    last_name: last,
    email: `e2e-crm-${Date.now()}@jyt.test`,
    phone: "+911234567890",
    title: "Head weaver",
  })
  const created = Array.isArray(person) ? person[0] : person

  const activityBody = "Asked for a photo of the border before sampling."
  await crm.recordCrmActivity({
    related_type: "person",
    related_id: created.id,
    activity_type: "message",
    direction: "inbound",
    channel: "whatsapp",
    body: activityBody,
  })

  return {
    personId: created.id,
    personName: `${first} ${last}`,
    activityBody,
  }
}

/**
 * Partner + two linked payment methods for the partner-UI settings/payments
 * spec (edit + delete). Mirrors `seedShipmentGatePartner` for auth, then links
 * two `internal_payment_details` rows to the partner via the same
 * `partner ↔ internal_payments` link the create workflow writes.
 *
 * TWO methods, deliberately: the edit case renames one and the delete case
 * removes the other, so neither case mutates the other's fixture. Both carry a
 * stamped account name — the spec selects rows by that text, and a repeat seed
 * must not produce two rows reading the same thing.
 */
async function seedPaymentMethodsPartner(container: any): Promise<{
  partnerId: string
  email: string
  password: string
  editMethodId: string
  editMethodName: string
  deleteMethodId: string
  deleteMethodName: string
}> {
  const partnerModule: any = container.resolve("partner")
  const authModule = container.resolve(Modules.AUTH)
  const link: any = container.resolve(ContainerRegistrationKeys.LINK)
  const payments: any = container.resolve("internal_payments")

  const stamp = Date.now()

  const created = await partnerModule.createPartners({
    name: `E2E Payments Partner ${stamp}`,
    handle: `e2e-payments-${stamp}`,
    status: "active",
    is_verified: true,
  })
  const partnerId = Array.isArray(created) ? created[0].id : created.id

  const email = `e2e-payments-${stamp}@jyt.test`
  await partnerModule.createPartnerAdmins({
    email,
    first_name: "E2E",
    last_name: "Payments",
    role: "admin",
    partner_id: partnerId,
  })

  const hashConfig = { logN: 15, r: 8, p: 1 }
  const passwordHash = await Scrypt.kdf(SEED_PASSWORD, hashConfig)
  const authIdentity: any = await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: email,
        provider_metadata: { password: passwordHash.toString("base64") },
      },
    ],
    app_metadata: { partner_id: partnerId },
  })
  const authIdentityId = Array.isArray(authIdentity)
    ? authIdentity[0].id
    : authIdentity.id

  const now = new Date()
  await authModule.createAuthVerifications([
    {
      auth_identity_id: authIdentityId,
      entity_id: email,
      entity_type: "email",
      code_provider: "emailpass",
      requested_at: now,
      verified_at: now,
    },
  ])

  const mkMethod = async (suffix: string, type: string) => {
    const createdMethod = await payments.createPaymentDetails({
      type,
      account_name: `E2E ${suffix} Acct ${stamp}`,
      account_number: `E2E-ACCT-${suffix}-${stamp}`,
      bank_name: "E2E Bank",
      ifsc_code: "E2E0000123",
      wallet_id: null,
    })
    const method = Array.isArray(createdMethod) ? createdMethod[0] : createdMethod

    await link.create({
      partner: { partner_id: partnerId },
      internal_payments: { internal_payment_details_id: method.id },
    })

    return { id: method.id as string, name: method.account_name as string }
  }

  const editMethod = await mkMethod("Edit", "bank_account")
  const deleteMethod = await mkMethod("Delete", "bank_account")

  return {
    partnerId,
    email,
    password: SEED_PASSWORD,
    editMethodId: editMethod.id,
    editMethodName: editMethod.name,
    deleteMethodId: deleteMethod.id,
    deleteMethodName: deleteMethod.name,
  }
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

  logger.info("E2E seed: creating design with a full brief for the designer-invite flow (#1113)...")
  const inviteDesignId = await seedDesignerInviteDesign(container)

  logger.info("E2E seed: creating the #1195 requires_shipping gate order...")
  const gate = await seedShipmentGateOrder(container)

  logger.info("E2E seed: creating the #1195 gate partner (partner-UI spec)...")
  const gatePartner = await seedShipmentGatePartner(container, gate.orderId)

  logger.info("E2E seed: creating the HSN-gap product (customs specs)...")
  const hsnGap = await seedHsCodeGapProduct(container)

  logger.info("E2E seed: creating the #1228 parked production run + partners...")
  const parkedRun = await seedParkedProductionRun(container)

  logger.info("E2E seed: creating the #1363 allocation design (3-item BOM) + approvable run...")
  const allocation = await seedAllocationDesignRun(container)

  logger.info("E2E seed: creating the gate order's partner fee (payout spec)...")
  const gateFee = await seedPartnerFeeForGateOrder(
    container,
    gate.orderId,
    gatePartner.partnerId,
    gate.currencyCode
  )

  logger.info("E2E seed: creating the #1556 payable production runs + partner...")
  const payableRuns = await seedPayableProductionRuns(container)

  logger.info("E2E seed: creating the #1439 admin quote fixtures (active + superseded)...")
  const adminQuotes = await seedAdminQuotes(container)

  /**
   * ⚠️ The CRM is an OPTIONAL integration and its absence must not take the
   * whole suite down.
   *
   * The module is gated on `CRM_NODE_URL` (proxy mode) or `CRM_HYPERBEE=true`
   * (embedded); with neither it registers but its repository does not, so the
   * first write throws `Could not resolve 'crmPersonService'`. On a developer
   * box with no CRM configured that killed the seed outright — and a seed that
   * dies takes every spec with it, including the ones that have nothing to do
   * with the CRM. The failure then reads as "e2e is broken" rather than "one
   * optional integration is not wired here".
   *
   * Skipping is loud, not silent: the warning names the env vars, and the CRM
   * spec fails on the missing seed keys rather than passing vacuously.
   */
  logger.info("E2E seed: creating the CRM contact + one logged activity...")
  let crmContact: {
    personId: string
    personName: string
    activityBody: string
  } | null = null
  try {
    crmContact = await seedCrmContact(container)
  } catch (e: any) {
    logger.warn(
      `E2E seed: CRM fixtures skipped — ${e?.message ?? e}. ` +
        `Set CRM_NODE_URL (proxy) or CRM_HYPERBEE=true to seed them; the CRM spec will fail without them.`
    )
  }

  logger.info("E2E seed: creating content editor partner + website + page + blocks...")
  const contentEditor = await seedContentEditorPartner(container)

  logger.info("E2E seed: creating payment-methods partner + two methods (settings/payments spec)...")
  const paymentMethods = await seedPaymentMethodsPartner(container)

  const seedData = {
    email,
    password: SEED_PASSWORD,
    websiteId: website.id,
    domain,
    shipmentOrderId,
    provenanceProductId,
    inviteDesignId,
    // #1195 gate fixture — consumed by order-shipment-gate.spec.ts (admin, CI)
    // and partner-shipment-gate.spec.ts (@partnerui, local).
    gateOrderId: gate.orderId,
    gateFulfillmentId: gate.fulfillmentId,
    gatePartnerEmail: gatePartner.email,
    gatePartnerPassword: gatePartner.password,
    gatePartnerId: gatePartner.partnerId,
    // HSN-gap fixture — a variant-backed product with no HS code at any level,
    // consumed by hs-code-bulk-fill.spec.ts.
    hsnGapProductId: hsnGap.productId,
    hsnGapVariantId: hsnGap.variantId,
    // Expected payout arithmetic for partner-order-payout-summary.spec.ts.
    gateOrderCurrency: gate.currencyCode,
    gateFee,
    // #1228 manual-reassignment fixture — consumed by
    // production-run-reassign.spec.ts (admin, CI).
    parkedRunId: parkedRun.runId,
    parkedRunDesignId: parkedRun.designId,
    parkedRunLapsedPartnerId: parkedRun.lapsedPartnerId,
    parkedRunLapsedPartnerName: parkedRun.lapsedPartnerName,
    parkedRunFreshPartnerName: parkedRun.freshPartnerName,
    // CRM contact fixture — consumed by crm-contact-activity.spec.ts (admin,
    // CI). Requires CRM_HYPERBEE=true so the embedded store is registered.
    // Absent when the CRM is not wired in this environment — see the skip
    // above. The spec asserts on these and fails loudly rather than passing
    // against an undefined it never noticed.
    crmPersonId: crmContact?.personId ?? null,
    crmPersonName: crmContact?.personName ?? null,
    crmActivityBody: crmContact?.activityBody ?? null,
    // Visual block editor fixture — consumed by visual-block-editor.spec.ts
    // (@partnerui, local only).
    contentEditorEmail: contentEditor.email,
    contentEditorPassword: contentEditor.password,
    contentEditorPartnerId: contentEditor.partnerId,
    contentEditorPageId: contentEditor.pageId,
    contentEditorWebsiteId: contentEditor.websiteId,
    // Payment-methods fixture — consumed by partner-payment-methods.spec.ts
    // (@partnerui). The delete case removes its method; the edit case renames
    // its own — each is single-use per seed, which `pnpm e2e` refreshes.
    paymentsPartnerEmail: paymentMethods.email,
    paymentsPartnerPassword: paymentMethods.password,
    paymentsEditMethodId: paymentMethods.editMethodId,
    paymentsEditMethodName: paymentMethods.editMethodName,
    paymentsDeleteMethodId: paymentMethods.deleteMethodId,
    paymentsDeleteMethodName: paymentMethods.deleteMethodName,
    // #1363 per-assignment material allocation — consumed by
    // production-run-material-allocation.spec.ts (admin, CI). SINGLE-USE like
    // every other run fixture: the spec approves the run, and an approved run
    // cannot be approved again.
    allocationRunId: allocation.runId,
    allocationDesignId: allocation.designId,
    allocationDesignName: allocation.designName,
    allocationPartnerAName: allocation.partnerAName,
    allocationPartnerBName: allocation.partnerBName,
    allocationMaterialALabel: allocation.materialALabel,
    allocationMaterialBLabel: allocation.materialBLabel,
    allocationMaterialCLabel: allocation.materialCLabel,
    allocationMaterialAId: allocation.materialAId,
    allocationMaterialCId: allocation.materialCId,
    // #1556 payable production runs — consumed by
    // payment-submission-payable-runs.spec.ts (admin, CI).
    //
    // ⚠️ `billableRunId` is SINGLE-USE: the spec creates a real payment
    // submission against it, and the run-level guard then refuses to bill that
    // run again — so that one case needs a fresh seed per suite run (which is
    // what `pnpm e2e` does). `payableRunId` and `unpricedRunId` are never
    // billed and survive a re-run.
    payoutPartnerId: payableRuns.partnerId,
    payoutPartnerName: payableRuns.partnerName,
    payoutDesignId: payableRuns.designId,
    payoutDesignName: payableRuns.designName,
    payableRunId: payableRuns.payableRunId,
    billableRunId: payableRuns.billableRunId,
    partnerBillableDesignName: payableRuns.partnerBillableDesignName,
    unpricedRunId: payableRuns.unpricedRunId,
    // #1571 B half — the partner UI signs in as this partner.
    payoutPartnerEmail: payableRuns.partnerEmail,
    payoutPartnerPassword: SEED_PASSWORD,
    partnerBillableRunId: payableRuns.partnerBillableRunId,
    partnerSumRunAId: payableRuns.partnerSumRunAId,
    partnerSumRunBId: payableRuns.partnerSumRunBId,
    sumDesignName: payableRuns.sumDesignName,
    // #1439 S3/S4 admin quote surface — consumed by admin-quote-surface.spec.ts
    // (admin, CI). NOT single-use: the spec cancels out of the revoke prompt
    // rather than confirming it, so a re-run finds the same active quote.
    quotePartnerId: adminQuotes.partnerId,
    quotePartnerName: adminQuotes.partnerName,
    activeQuoteId: adminQuotes.activeQuoteId,
    activeQuoteCompany: adminQuotes.activeQuoteCompany,
    supersededQuoteId: adminQuotes.supersededQuoteId,
    supersededQuoteCompany: adminQuotes.supersededQuoteCompany,
    // #1439 S11 — an accepted quote with a real payment schedule, and one whose
    // deposit is deliberately 0 rather than absent.
    acceptedQuoteId: adminQuotes.acceptedQuoteId,
    acceptedQuoteCompany: adminQuotes.acceptedQuoteCompany,
    zeroDepositQuoteId: adminQuotes.zeroDepositQuoteId,
    zeroDepositQuoteCompany: adminQuotes.zeroDepositQuoteCompany,
  }

  fs.writeFileSync(SEED_FILE, JSON.stringify(seedData, null, 2))
  logger.info(`E2E seed complete. Credentials saved to ${SEED_FILE}`)
}
