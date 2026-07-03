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
  CONNECT_CONFIG_PROVIDER_ID,
  resolvePartnerConnect,
  connectContext,
} from "../modules/stripe-connect-payment/lib/resolve-connect"

/**
 * PROD-SAFE Stripe Connect routing probe (rung 2 of the #838 go-live
 * verification ladder). Proves that a REAL storefront cart on a partner's sales
 * channel produces a Stripe PaymentIntent ON THAT PARTNER'S connected account
 * with the platform application fee — WITHOUT confirming/capturing it, so NO
 * money moves. The unconfirmed PaymentIntent is cancelled and the ephemeral cart
 * deleted at the end.
 *
 * Unlike `stripe-connect-e2e-test.ts` (test mode; creates a throwaway connected
 * account + seeds config), this probe uses the ACTUAL onboarded partners already
 * in the DB and is therefore safe to run against LIVE Stripe.
 *
 * Run (prod, ECS one-off or locally against a prod-scoped DB):
 *   STRIPE_CONNECT_ENABLED=true npx medusa exec ./src/scripts/stripe-connect-verify-routing.ts
 *
 * Optional scope to one partner:
 *   PROBE_PARTNER_ID=part_… npx medusa exec ./src/scripts/stripe-connect-verify-routing.ts
 *
 * It NEVER calls paymentIntents.confirm — routing is asserted from the created
 * session/intent alone. Safe by construction.
 */
export default async function ({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const configService: any = container.resolve("partner_payment_config")
  const cartService: any = container.resolve(Modules.CART)

  const step = (n: string) => logger.info(`\n━━━ ${n} ━━━`)
  const scopePartnerId = process.env.PROBE_PARTNER_ID?.trim() || undefined

  const key = process.env.STRIPE_API_KEY || ""
  if (!key) {
    logger.error("STRIPE_API_KEY is not set — cannot talk to Stripe. Aborting.")
    return
  }
  const live = /^sk_live_/.test(key)
  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(key)
  logger.info(`Stripe key mode: ${live ? "LIVE" : "test"} (probe never confirms — no money moves either way)`)

  // ── 1. Find onboarded, charges-enabled connected partners ────────────
  step("1. Find onboarded connected partners")
  const configFilters: Record<string, unknown> = { provider_id: CONNECT_CONFIG_PROVIDER_ID }
  if (scopePartnerId) configFilters.partner_id = scopePartnerId
  const configs = await configService.listPartnerPaymentConfigs(configFilters)
  const ready = (configs ?? []).filter(
    (c: any) => c?.connect_account_id && c?.connect_charges_enabled
  )
  if (!ready.length) {
    logger.warn(
      "No partner has a charges-enabled Stripe connected account yet. " +
        "Complete the hosted onboarding link (partner-ui → Stripe Connect card) first, " +
        "then re-run this probe."
    )
    return
  }
  logger.info(`${ready.length} connected partner(s) with charges enabled.`)

  // ── 2. For each, resolve store / sales channel / an EUR priced variant
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "name", "default_sales_channel_id", "partner.id"],
  })
  const storeByPartner = new Map<string, any>()
  for (const s of stores as any[]) {
    if (s.partner?.id && s.default_sales_channel_id) storeByPartner.set(s.partner.id, s)
  }

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
  })
  const eurRegions = (regions as any[]).filter(
    (r) => String(r.currency_code).toLowerCase() === "eur"
  )
  if (!eurRegions.length) {
    logger.warn("No EUR region found — nothing to route an EUR checkout through.")
    return
  }

  let passes = 0
  let attempts = 0

  for (const cfg of ready) {
    const partnerId = cfg.partner_id
    const store = storeByPartner.get(partnerId)
    if (!store) {
      logger.warn(`partner ${partnerId}: no store with a default sales channel — skipping.`)
      continue
    }
    const salesChannelId = store.default_sales_channel_id

    // A priced variant in an EUR region (probe uses EUR — Connect's rail).
    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "product.id", "prices.amount", "prices.currency_code"],
      pagination: { take: 200 },
    })
    let pick: { variantId: string; regionId: string; amount: number } | null = null
    for (const v of variants as any[]) {
      const eurPrice = (v.prices ?? []).find(
        (p: any) => String(p.currency_code).toLowerCase() === "eur"
      )
      if (eurPrice && v.product?.id) {
        pick = { variantId: v.id, regionId: eurRegions[0].id, amount: eurPrice.amount }
        break
      }
    }
    if (!pick) {
      logger.warn(`partner ${partnerId}: no EUR-priced variant found — skipping.`)
      continue
    }

    attempts++
    step(`2.${attempts} Probe partner ${partnerId} (${store.name})`)

    // Resolve routing the way the real store route does (rung 1).
    const connect = await resolvePartnerConnect(container, salesChannelId, 0)
    if (!connect) {
      logger.error(
        `✗ partner ${partnerId}: resolvePartnerConnect returned null — its config is not active/routable.`
      )
      continue
    }
    logger.info(
      `resolvePartnerConnect → acct=${connect.connect_account_id} fee%=${connect.fee_percent}`
    )
    if (connect.connect_account_id !== cfg.connect_account_id) {
      logger.error(
        `✗ routing mismatch: resolved ${connect.connect_account_id}, config has ${cfg.connect_account_id}`
      )
      continue
    }

    let cartId: string | null = null
    let intentId: string | null = null
    let intentAcct: string | null = null
    try {
      // Ephemeral cart on the partner's sales channel.
      const { result: cart } = await createCartWorkflow(container).run({
        input: {
          region_id: pick.regionId,
          sales_channel_id: salesChannelId,
          currency_code: "eur",
          email: "connect-probe@jaalyantra.com",
          items: [{ variant_id: pick.variantId, quantity: 1 }],
        },
      })
      cartId = cart.id

      const { result: pc } = await createPaymentCollectionForCartWorkflow(container).run({
        input: { cart_id: cart.id },
      })

      // Create the stripe-connect session — this is what mints the PaymentIntent
      // on the connected account (still UNCONFIRMED → no charge).
      await createPaymentSessionsWorkflow(container).run({
        input: {
          payment_collection_id: (pc as any).id,
          provider_id: "pp_stripe-connect_stripe-connect",
          context: { sales_channel_id: salesChannelId, ...connectContext(connect) },
        },
      })

      const { data: pcs } = await query.graph({
        entity: "payment_collection",
        fields: [
          "id",
          "payment_sessions.id",
          "payment_sessions.provider_id",
          "payment_sessions.data",
        ],
        filters: { id: (pc as any).id },
      })
      const session = (pcs as any[])[0]?.payment_sessions?.find(
        (s: any) => s.provider_id === "pp_stripe-connect_stripe-connect"
      )
      if (!session) {
        logger.error("✗ no stripe-connect payment session was created.")
        continue
      }
      intentId = session.data?.id as string
      intentAcct = session.data?.connect_account_id as string
      const fee = Number(session.data?.application_fee_amount ?? 0)
      logger.info(`session=${session.id} intent=${intentId} on_account=${intentAcct} fee=${fee}`)

      const routedOk = intentAcct === cfg.connect_account_id
      if (routedOk && fee > 0) {
        passes++
        logger.info(`✅ PASS — intent routes to ${intentAcct} with application fee ${fee} (no money moved).`)
      } else if (routedOk) {
        passes++
        logger.warn(
          `⚠ PASS (routing) but fee=${fee}. Intent is on the right account; seed an active ` +
            `partner_subscription plan payment_processing_fee (or STRIPE_CONNECT_DEFAULT_FEE_PERCENT) to charge a fee.`
        )
      } else {
        logger.error(`✗ routing FAILED: intent on ${intentAcct}, expected ${cfg.connect_account_id}`)
      }
    } catch (e: any) {
      logger.error(`✗ partner ${partnerId}: probe error — ${e?.message ?? e}`)
    } finally {
      // Tear down the only Stripe side effect (the unconfirmed intent) + the cart.
      if (intentId && intentAcct) {
        try {
          await stripe.paymentIntents.cancel(intentId, { stripeAccount: intentAcct })
          logger.info(`cleaned up: cancelled intent ${intentId}`)
        } catch (e: any) {
          logger.warn(`could not cancel intent ${intentId}: ${e?.message ?? e}`)
        }
      }
      if (cartId) {
        try {
          await cartService.deleteCarts([cartId])
          logger.info(`cleaned up: deleted cart ${cartId}`)
        } catch (e: any) {
          logger.warn(`could not delete cart ${cartId} (harmless, abandoned): ${e?.message ?? e}`)
        }
      }
    }
  }

  step("Result")
  logger.info(
    `${passes}/${attempts} connected partner(s) route correctly to their Stripe connected account. ` +
      `No PaymentIntent was confirmed — zero money moved.`
  )
}
