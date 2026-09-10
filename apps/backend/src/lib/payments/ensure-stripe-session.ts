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
} from "../../modules/stripe-connect-payment/lib/resolve-connect"
import { resolveSalesChannelForCollection } from "../../modules/payu-payment/lib/resolve-partner-creds"
import { resolveCollectionPaymentContext } from "./resolve-collection-customer"

/** The Medusa Stripe provider id. */
export const STRIPE_PROVIDER_ID = "pp_stripe_stripe"

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

  const salesChannelId = await resolveSalesChannelForCollection(
    scope,
    collectionId
  ).catch(() => undefined)

  const connect = await resolvePartnerConnect(
    scope,
    salesChannelId,
    Number(process.env.STRIPE_CONNECT_DEFAULT_FEE_PERCENT) || 0
  ).catch(() => null)

  const context = {
    ...(salesChannelId ? { sales_channel_id: salesChannelId } : {}),
    ...connectContext(connect),
  }

  const { customer_id } = await resolveCollectionPaymentContext(
    scope,
    collectionId
  ).catch(() => ({ customer_id: undefined }) as any)

  try {
    await createPaymentSessionsWorkflow(scope).run({
      input: {
        payment_collection_id: collectionId,
        provider_id: STRIPE_PROVIDER_ID,
        ...(customer_id ? { customer_id } : {}),
        ...(Object.keys(context).length ? { context } : {}),
      },
    })
  } catch (e: any) {
    logger?.error?.(
      `[pay-collection] session creation failed for ${collectionId}: ${
        e?.message ?? e
      }`
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
