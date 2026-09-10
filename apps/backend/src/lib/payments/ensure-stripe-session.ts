/**
 * Ensure a payment collection has a usable Stripe session (#1985).
 *
 * An order EDIT that raises the total creates a second payment collection with
 * an outstanding amount and **no payment sessions at all** — nothing in the
 * order-edit flow mints one. Until something does, there is no `client_secret`,
 * so there is nothing for a buyer to pay against and nothing for a payment page
 * to render.
 *
 * The deposit and the balance each already have a rail that ends in a hosted
 * Stripe page; both get their session from a workflow that runs BEFORE the page
 * is opened. An edit has no such workflow, so the page has to be able to mint
 * one on demand — which is what this does.
 *
 * ## Why not a Stripe Payment Link
 *
 * The same reason `stripe/pay/balance` gives: a Payment Link's charge arrives as
 * an object with no payment collection, no order association and nothing for the
 * admin to capture or reconcile against. Mounting the Payment Element on the
 * collection's OWN Medusa session keeps the money in the records the order
 * already uses, so `paid_total` moves by itself.
 *
 * ## Partner routing
 *
 * Resolved here rather than in the provider: payment providers run in an
 * isolated module container and cannot resolve a partner themselves. This
 * mirrors the store route
 * (`/store/payment-collections/:id/payment-sessions`) — the two must agree,
 * because a buyer can reach the same collection through either.
 *
 * Best-effort, exactly as that route is: no partner / no active config → empty
 * context → the provider keeps its platform behaviour.
 *
 * ## 🔴 The mint can fail on DATA, not code
 *
 * `createPaymentSessionsWorkflow` throws
 * `Payment provider pp_stripe_stripe is not enabled in the cart's region <id>`
 * when the order's region has no Stripe provider attached. Measured locally
 * against a real collection. That is an operator condition, not a bug, and the
 * page must degrade to "cannot be opened just now" rather than 500 — so the
 * reason is logged precisely and the buyer is told something they can act on.
 *
 * A collection whose order already carries an authorised Stripe session is
 * proof the region is configured, which is the common case for an order edit:
 * the deposit went through the same region minutes or weeks earlier.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows"

import {
  resolvePartnerConnect,
  connectContext,
  resolvePartnerConnectedByRegion,
  CONNECT_CHECKOUT_PROVIDER_ID,
} from "../../modules/stripe-connect-payment/lib/resolve-connect"
import { resolveSalesChannelForCollection } from "../../modules/payu-payment/lib/resolve-partner-creds"
import { resolveCollectionPaymentContext } from "./resolve-collection-customer"

/** The Medusa Stripe provider id. */
export const STRIPE_PROVIDER_ID = "pp_stripe_stripe"

/**
 * PURE: which Stripe provider to open a session with, given the providers the
 * ORDER'S REGION actually has enabled.
 *
 * 🔴 Asking for `pp_stripe_stripe` unconditionally is wrong and fails loudly:
 * `createPaymentSessionsWorkflow` throws "Payment provider pp_stripe_stripe is
 * not enabled in the cart's region <id>". Measured against a real region that
 * has ONLY `pp_stripe-connect_stripe-connect` enabled — which is the ordinary
 * shape for a partner storefront, since `/store/payment-providers` hands an
 * onboarded partner the Connect provider (#985).
 *
 * Follows the same rule as `dedupeStripeProviders`, deliberately: a buyer must
 * be charged through the same provider whichever door they came in by. The
 * preferred provider is only chosen when it is actually enabled, so a region
 * carrying just one of the two is never left with nothing.
 *
 * Returns null when the region enables no Stripe provider at all — the caller
 * then renders "unavailable" rather than throwing.
 */
export function stripeProviderCandidates(
  regionProviderIds: Array<string | null | undefined>,
  connected: boolean
): string[] {
  const stripe = (regionProviderIds ?? []).filter((id): id is string =>
    String(id ?? "").includes("stripe")
  )
  if (!stripe.length) return []

  const preferred = connected ? CONNECT_CHECKOUT_PROVIDER_ID : STRIPE_PROVIDER_ID
  const first = stripe.filter((id) => id === preferred)
  const rest = stripe.filter((id) => id !== preferred)
  return [...first, ...rest]
}

/** The provider to try first. Thin wrapper over `stripeProviderCandidates`. */
export function pickStripeProviderId(
  regionProviderIds: Array<string | null | undefined>,
  connected: boolean
): string | null {
  return stripeProviderCandidates(regionProviderIds, connected)[0] ?? null
}

/** Fields a payment page needs off a collection. Shared so the read that
 *  decides "already paid" and the read that renders cannot disagree. */
export const COLLECTION_PAGE_FIELDS = [
  "id",
  "amount",
  "status",
  "currency_code",
  "payment_sessions.id",
  "payment_sessions.provider_id",
  "payment_sessions.status",
  "payment_sessions.data",
  "payments.id",
  "payments.amount",
  "payments.captured_at",
]

/**
 * PURE: the Stripe session on a collection, or null.
 *
 * Matches on `provider_id` CONTAINING "stripe" rather than equalling the
 * default id — a Connect-routed session carries a different provider id, and
 * an exact match would silently miss it and mint a duplicate session.
 * Exported for unit testing.
 */
export function pickStripeSession(collection: any): any | null {
  const sessions = (collection?.payment_sessions ?? []) as any[]
  return (
    sessions.find((s) => String(s?.provider_id ?? "").includes("stripe")) ?? null
  )
}

/**
 * PURE: is there nothing left to pay on this collection?
 *
 * `status` is the primary signal; a captured payment is the backstop for the
 * window where a webhook has recorded the money but the collection status has
 * not caught up. Either one means "paid" — a buyer must never be shown a
 * payment form for money they have already sent.
 *
 * Exported for unit testing.
 */
export function isCollectionSettled(collection: any): boolean {
  const status = String(collection?.status ?? "")
  if (status === "completed" || status === "authorized" || status === "paid") {
    return true
  }
  return ((collection?.payments ?? []) as any[]).some((p) => !!p?.captured_at)
}

/**
 * Read a payment collection with everything a page needs.
 * Returns null when it does not exist — the caller renders "not a valid link"
 * rather than throwing, because the id in the URL comes from a buyer.
 */
export async function readCollectionForPage(
  scope: any,
  collectionId: string
): Promise<any | null> {
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
  try {
    const { data } = await query.graph({
      entity: "payment_collection",
      fields: COLLECTION_PAGE_FIELDS,
      filters: { id: collectionId },
    })
    return (data?.[0] as any) ?? null
  } catch {
    return null
  }
}

/**
 * The order behind a payment collection, with the routing facts a session needs.
 *
 * 🔴 An order-EDIT collection has NO CART. `resolveSalesChannelForCollection`
 * walks `cart_payment_collection` → cart, which is the right path for a
 * checkout and returns nothing here — so the partner routing and the region
 * both have to come from the ORDER instead. Reading only the cart link is why
 * this silently lost the region, and the region is what decides which Stripe
 * provider may be used at all.
 *
 * Returns empty fields rather than throwing; every caller degrades.
 */
export async function resolveCollectionOrderRouting(
  scope: any,
  collectionId: string
): Promise<{
  orderId?: string
  regionId?: string
  salesChannelId?: string
  regionProviderIds: string[]
}> {
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
  const empty = { regionProviderIds: [] as string[] }

  const { data: links } = await query
    .graph({
      entity: "order_payment_collection",
      filters: { payment_collection_id: collectionId },
      fields: ["order_id"],
    })
    .catch(() => ({ data: [] }))

  const orderId = links?.[0]?.order_id

  /**
   * Order first, then cart. A collection raised by an EDIT hangs off the order;
   * one raised at CHECKOUT hangs off the cart. Both carry a region, and it is
   * the region — not the collection — that decides which providers may be used,
   * so whichever link exists has to be followed.
   */
  let holder: any = null
  if (orderId) {
    const { data } = await query
      .graph({
        entity: "order",
        filters: { id: orderId },
        fields: ["id", "region_id", "sales_channel_id"],
      })
      .catch(() => ({ data: [] }))
    holder = data?.[0] ?? null
  }

  if (!holder) {
    const { data: cartLinks } = await query
      .graph({
        entity: "cart_payment_collection",
        filters: { payment_collection_id: collectionId },
        fields: ["cart_id"],
      })
      .catch(() => ({ data: [] }))
    const cartId = cartLinks?.[0]?.cart_id
    if (cartId) {
      const { data } = await query
        .graph({
          entity: "cart",
          filters: { id: cartId },
          fields: ["id", "region_id", "sales_channel_id"],
        })
        .catch(() => ({ data: [] }))
      holder = data?.[0] ?? null
    }
  }

  if (!holder?.region_id) {
    return { ...(orderId ? { orderId } : {}), regionProviderIds: [] }
  }

  const { data: regions } = await query
    .graph({
      entity: "region",
      filters: { id: holder.region_id },
      fields: ["id", "payment_providers.id"],
    })
    .catch(() => ({ data: [] }))

  const regionProviderIds = ((regions?.[0]?.payment_providers ?? []) as any[])
    .map((p) => p?.id)
    .filter((id): id is string => typeof id === "string")

  return {
    ...(orderId ? { orderId } : {}),
    regionId: holder.region_id ?? undefined,
    salesChannelId: holder.sales_channel_id ?? undefined,
    regionProviderIds,
  }
}

/**
 * Give `collectionId` a Stripe session if it has none, and return the
 * collection re-read afterwards.
 *
 * Idempotent by construction: an existing Stripe session short-circuits, so
 * reopening the link does not mint a second PaymentIntent and does not replace
 * the one the buyer may already be part-way through.
 *
 * 🔴 Never throws. A failure here must degrade to "this link cannot be opened
 * just now" — a page that 500s tells the buyer nothing and tells us nothing
 * either. The reason is logged; the buyer is told to ask for a new link.
 */
export async function ensureStripeSessionForCollection(
  scope: any,
  collectionId: string
): Promise<{ collection: any | null; session: any | null; created: boolean }> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)

  let collection = await readCollectionForPage(scope, collectionId)
  if (!collection) {
    return { collection: null, session: null, created: false }
  }

  const existing = pickStripeSession(collection)
  if (existing) {
    return { collection, session: existing, created: false }
  }

  // Settled collections never get a session — minting one would create a
  // PaymentIntent for money that has already arrived.
  if (isCollectionSettled(collection)) {
    return { collection, session: null, created: false }
  }

  const routing = await resolveCollectionOrderRouting(
    scope,
    collectionId
  ).catch(() => ({ regionProviderIds: [] as string[] }) as any)

  // Cart link first (a checkout collection), then the order (an edit's).
  const salesChannelId =
    (await resolveSalesChannelForCollection(scope, collectionId).catch(
      () => undefined
    )) ?? routing.salesChannelId

  const connect = await resolvePartnerConnect(
    scope,
    salesChannelId,
    Number(process.env.STRIPE_CONNECT_DEFAULT_FEE_PERCENT) || 0
  ).catch(() => null)

  /**
   * Whether to prefer the Connect provider. `resolvePartnerConnect` answers it
   * for a sales channel; an order edit may have neither cart nor channel, so
   * the region's own partner link is the fallback — the same signal
   * `/store/payment-providers` uses to decide what the buyer is offered.
   */
  const connected =
    !!connect ||
    (await resolvePartnerConnectedByRegion(scope, routing.regionId).catch(
      () => false
    ))

  const candidates = stripeProviderCandidates(
    routing.regionProviderIds,
    connected
  )
  if (!candidates.length) {
    logger?.error?.(
      `[pay-collection] no Stripe provider enabled for collection=${collectionId} ` +
        `region=${routing.regionId ?? "unknown"} ` +
        `providers=[${routing.regionProviderIds.join(",") || "none"}]`
    )
    return { collection, session: null, created: false }
  }

  const context = {
    ...(salesChannelId ? { sales_channel_id: salesChannelId } : {}),
    ...connectContext(connect),
  }

  const { customer_id } = await resolveCollectionPaymentContext(
    scope,
    collectionId
  ).catch(() => ({ customer_id: undefined }) as any)

  /**
   * Try each enabled Stripe provider, preferred first.
   *
   * 🔴 A region can ENABLE a provider the container does not REGISTER — proven
   * locally, where the India region enables `pp_stripe-connect_stripe-connect`
   * and the module resolves to "Unable to retrieve the payment provider with
   * id". Region config and module registration are edited in different places
   * and drift. On a page a buyer has opened to pay us, falling through to the
   * other Stripe provider is worth far more than being right about which one
   * "should" have worked.
   */
  let minted = false
  let lastError: string | null = null
  for (const providerId of candidates) {
    try {
      await createPaymentSessionsWorkflow(scope).run({
        input: {
          payment_collection_id: collectionId,
          provider_id: providerId,
          ...(customer_id ? { customer_id } : {}),
          ...(Object.keys(context).length ? { context } : {}),
        },
      })
      minted = true
      break
    } catch (e: any) {
      lastError = e?.message ?? String(e)
      logger?.warn?.(
        `[pay-collection] provider ${providerId} failed for ${collectionId}: ${lastError}`
      )
    }
  }

  if (!minted) {
    logger?.error?.(
      `[pay-collection] session creation failed for ${collectionId} after trying ` +
        `[${candidates.join(",")}]: ${lastError}`
    )
    return { collection, session: null, created: false }
  }

  // Re-read rather than trusting the workflow's return: the session we render
  // must be the one actually persisted on the collection.
  collection = await readCollectionForPage(scope, collectionId)
  return {
    collection,
    session: pickStripeSession(collection),
    created: true,
  }
}
