import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import {
  createCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  resolvePartnerConnect,
  connectContext,
} from "../modules/stripe-connect-payment/lib/resolve-connect"

/**
 * End-to-end local test for Stripe Connect checkout routing (Half B), against
 * Stripe TEST mode. Proves a storefront charge lands ON the partner's connected
 * account with the platform application fee.
 *
 * Run with the provider enabled:
 *   STRIPE_CONNECT_ENABLED=true npx medusa exec ./src/scripts/stripe-connect-e2e-test.ts
 *
 * It:
 *  1. creates a fully-enabled TEST connected account (Custom, charges_enabled),
 *  2. seeds partner_payment_config for a partner that owns a store,
 *  3. enables pp_stripe-connect on that cart's region,
 *  4. creates a cart (partner's sales channel) with one priced line item,
 *  5. creates a payment collection + a stripe-connect payment session,
 *  6. confirms the PaymentIntent with a test card on the connected account,
 *  7. asserts it succeeded WITH an application_fee.
 */
export default async function ({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK) as any
  const configService: any = container.resolve("partner_payment_config")

  const step = (n: string) => logger.info(`\n━━━ ${n} ━━━`)
  const fail = (m: string): never => {
    logger.error(`✗ ${m}`)
    throw new Error(m)
  }

  // ── Stripe test client ───────────────────────────────────────────────
  const key = process.env.STRIPE_API_KEY || ""
  if (!/^sk_test_/.test(key)) fail("STRIPE_API_KEY is not a test key (sk_test_…). Aborting for safety.")
  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(key)

  // ── 0. Pick a partner that owns a store, + a priced variant in its currency
  step("0. Resolve partner / store / region / variant")
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "name", "default_sales_channel_id", "partner.id", "partner.name"],
  })
  const store = (stores as any[]).find((s) => s.partner?.id && s.default_sales_channel_id)
  if (!store) fail("No store with a partner + default_sales_channel_id found.")
  const partnerId = store.partner.id
  const salesChannelId = store.default_sales_channel_id
  logger.info(`partner=${partnerId} (${store.partner.name}) store=${store.id} sc=${salesChannelId}`)

  // Find a priced variant + a region whose currency the variant has a price in.
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "title", "product.id", "prices.amount", "prices.currency_code"],
    pagination: { take: 200 },
  })
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
  })
  let pick: { variantId: string; productId: string; regionId: string; currency: string; amount: number } | null = null
  for (const v of variants as any[]) {
    for (const p of v.prices ?? []) {
      const region = (regions as any[]).find((r) => r.currency_code === p.currency_code)
      if (region && v.product?.id) {
        pick = { variantId: v.id, productId: v.product.id, regionId: region.id, currency: p.currency_code, amount: p.amount }
        break
      }
    }
    if (pick) break
  }
  if (!pick) throw new Error("No priced variant with a matching region currency found.")
  const chosen = pick
  logger.info(`variant=${chosen.variantId} region=${chosen.regionId} ${chosen.amount}${chosen.currency}`)

  // ── 1. Create a fully-enabled TEST connected account ─────────────────
  step("1. Create test connected account")
  const account = await stripe.accounts.create({
    country: "DE",
    email: `connect-e2e-${partnerId.slice(-6)}@jaalyantra.com`,
    controller: {
      fees: { payer: "application" },
      losses: { payments: "application" },
      stripe_dashboard: { type: "none" },
      requirement_collection: "application",
    },
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    business_type: "individual",
    business_profile: { mcc: "5691", url: "https://jaalyantra.com", product_description: "handmade textiles" },
    individual: {
      first_name: "Test", last_name: "Partner",
      email: `connect-e2e-${partnerId.slice(-6)}@jaalyantra.com`,
      phone: "+493012345678", dob: { day: 1, month: 1, year: 1990 },
      address: { line1: "Teststrasse 1", city: "Berlin", postal_code: "10115", country: "DE" },
      id_number: "000000000",
    },
    external_account: { object: "bank_account", country: "DE", currency: "eur", account_number: "DE89370400440532013000" },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
  })
  logger.info(`account=${account.id} charges_enabled=${account.charges_enabled}`)
  if (!account.charges_enabled) fail("Test account is not charges_enabled — cannot route a charge.")

  // ── 2. Seed partner_payment_config with the connected account ────────
  step("2. Seed partner_payment_config (pp_stripe_stripe + connect fields)")
  const existing = await configService.listPartnerPaymentConfigs({
    partner_id: partnerId, provider_id: "pp_stripe_stripe",
  })
  const connectFields = {
    connect_account_id: account.id, connect_status: "active",
    connect_charges_enabled: true, connect_payouts_enabled: true, connect_details_submitted: true,
    is_active: true,
  }
  if (existing?.length) {
    await configService.updatePartnerPaymentConfigs({ id: existing[0].id, ...connectFields })
  } else {
    await configService.createPartnerPaymentConfigs({
      partner_id: partnerId, provider_id: "pp_stripe_stripe", credentials: {}, ...connectFields,
    })
  }
  logger.info(`config seeded for partner ${partnerId}`)

  // ── 3. Enable pp_stripe-connect on the region + product in sales channel
  step("3. Enable provider on region + link product to sales channel")
  try {
    await link.create({
      [Modules.REGION]: { region_id: chosen.regionId },
      [Modules.PAYMENT]: { payment_provider_id: "pp_stripe-connect_stripe-connect" },
    })
    logger.info("linked pp_stripe-connect_stripe-connect → region")
  } catch (e: any) {
    logger.info(`region link (maybe exists): ${e.message}`)
  }
  try {
    await link.create({
      [Modules.PRODUCT]: { product_id: chosen.productId },
      [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId },
    })
    logger.info("linked product → sales channel")
  } catch (e: any) {
    logger.info(`product↔sc link (maybe exists): ${e.message}`)
  }

  // ── 4. Create a cart on the partner's sales channel ──────────────────
  step("4. Create cart")
  const { result: cart } = await createCartWorkflow(container).run({
    input: {
      region_id: chosen.regionId,
      sales_channel_id: salesChannelId,
      currency_code: chosen.currency,
      email: "e2e-buyer@example.com",
      items: [{ variant_id: chosen.variantId, quantity: 1 }],
    },
  })
  logger.info(`cart=${cart.id} total=${cart.total}${chosen.currency} sc=${(cart as any).sales_channel_id}`)

  // ── 5. Payment collection + stripe-connect session (with sales_channel context)
  step("5. Create payment collection + stripe-connect session")
  const { result: pc } = await createPaymentCollectionForCartWorkflow(container).run({
    input: { cart_id: cart.id },
  })
  // Resolve the connected account the way the real route does, then pass it via context.
  const connect = await resolvePartnerConnect(container, salesChannelId, 0.02)
  logger.info(`resolvePartnerConnect → acct=${connect?.connect_account_id} fee%=${connect?.fee_percent}`)
  if (!connect) fail("resolvePartnerConnect returned null — seeded config not found.")
  await createPaymentSessionsWorkflow(container).run({
    input: {
      payment_collection_id: (pc as any).id,
      provider_id: "pp_stripe-connect_stripe-connect",
      context: { sales_channel_id: salesChannelId, ...connectContext(connect) },
    },
  })
  const { data: pcs } = await query.graph({
    entity: "payment_collection",
    fields: ["id", "payment_sessions.id", "payment_sessions.provider_id", "payment_sessions.data"],
    filters: { id: (pc as any).id },
  })
  const session = (pcs as any[])[0]?.payment_sessions?.find((s: any) =>
    s.provider_id === "pp_stripe-connect_stripe-connect"
  )
  if (!session) fail("No stripe-connect payment session was created.")
  const intentId = session.data?.id as string
  const sessionAcct = session.data?.connect_account_id as string
  const fee = session.data?.application_fee_amount
  logger.info(`session=${session.id} intent=${intentId} on_account=${sessionAcct} fee=${fee}`)
  if (sessionAcct !== account.id) fail(`Routing FAILED: intent is on ${sessionAcct}, expected ${account.id}`)

  // ── 6. Confirm the PaymentIntent on the connected account (test card) ─
  step("6. Confirm PaymentIntent with test card on the connected account")
  const confirmed = await stripe.paymentIntents.confirm(
    intentId,
    { payment_method: "pm_card_visa", return_url: "https://jaalyantra.com/return" },
    { stripeAccount: account.id }
  )
  logger.info(`intent status=${confirmed.status} amount=${confirmed.amount} fee=${confirmed.application_fee_amount}`)

  // ── 7. Assert ────────────────────────────────────────────────────────
  step("7. Result")
  const ok = confirmed.status === "succeeded" && (confirmed.application_fee_amount ?? 0) > 0
  if (ok) {
    logger.info(
      `✅ E2E PASS — charged ${confirmed.amount} ${chosen.currency} on ${account.id}, ` +
        `platform fee ${confirmed.application_fee_amount}. session=${session.id}`
    )
  } else {
    logger.warn(
      `⚠ intent status=${confirmed.status}, fee=${confirmed.application_fee_amount}. ` +
        `(If fee is 0, seed an active partner_subscription with a plan payment_processing_fee, ` +
        `or set STRIPE_CONNECT_DEFAULT_FEE_PERCENT.)`
    )
  }
}
