import {
  MedusaRequest,
  MedusaResponse,
  refetchEntity,
} from "@medusajs/framework/http"
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows"
import {
  resolvePartnerPayuCredentials,
  resolveSalesChannelForCollection,
  payuContext,
} from "../../../../../modules/payu-payment/lib/resolve-partner-creds"
import {
  resolvePartnerConnect,
  connectContext,
} from "../../../../../modules/stripe-connect-payment/lib/resolve-connect"
import { resolveCollectionPaymentContext } from "../../../../../lib/payments/resolve-collection-customer"
import { saveCardSessionData } from "../../../../../lib/payments/save-card-intent"

const DEFAULT_FIELDS = ["id", "currency_code", "amount", "*payment_sessions"]

/**
 * Override of the core store payment-sessions route
 * (POST /store/payment-collections/:id/payment-sessions).
 *
 * Behaviourally identical to core, EXCEPT that for a partner storefront we
 * resolve the owning partner's merchant routing UPSTREAM here — where `query`
 * and other modules are available — and pass it to the provider via the
 * payment-session `context`. Payment providers run in an isolated module
 * container and cannot resolve the partner themselves.
 *
 *   • PayU  — resolves the partner's merchant credentials; without this the
 *     provider silently fell back to the platform's global PayU credentials,
 *     i.e. a partner's sale would be charged into JYT's own PayU account.
 *   • Stripe — when the buyer is handed the Connect provider (an onboarded
 *     partner — see the /store/payment-providers override, #985), resolve the
 *     partner's active connected account + plan fee so the charge routes a
 *     direct charge into the merchant's account (application fee to the
 *     platform). Previously this resolution only happened on the hosted payment
 *     page (`init-session.ts`), so a buyer selecting Stripe via the standard
 *     checkout never routed to the merchant.
 *
 * Resolution is best-effort in both cases: no partner / no active config →
 * empty context → provider keeps its legacy platform behaviour. Only PayU/Stripe
 * sessions incur the extra lookups.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const collectionId = req.params.id
  const { provider_id, data } = req.body as {
    provider_id: string
    data?: Record<string, unknown>
  }

  let context: Record<string, unknown> | undefined
  const pid = String(provider_id || "")
  if (pid.includes("payu")) {
    const salesChannelId = await resolveSalesChannelForCollection(
      req.scope,
      collectionId
    ).catch(() => undefined)
    const creds = await resolvePartnerPayuCredentials(
      req.scope,
      salesChannelId
    ).catch(() => null)
    const ctx = payuContext(creds)
    if (Object.keys(ctx).length) {
      context = ctx
    }
  } else if (pid.includes("stripe")) {
    const salesChannelId = await resolveSalesChannelForCollection(
      req.scope,
      collectionId
    ).catch(() => undefined)
    const connect = await resolvePartnerConnect(
      req.scope,
      salesChannelId,
      Number(process.env.STRIPE_CONNECT_DEFAULT_FEE_PERCENT) || 0
    ).catch(() => null)
    const ctx = {
      ...(salesChannelId ? { sales_channel_id: salesChannelId } : {}),
      ...connectContext(connect),
    }
    if (Object.keys(ctx).length) {
      context = ctx
    }
  }

  const { customer_id: cartCustomerId, plan } =
    await resolveCollectionPaymentContext(req.scope, collectionId).catch(
      () => ({ customer_id: undefined, plan: undefined })
    )

  await createPaymentSessionsWorkflow(req.scope).run({
    input: {
      payment_collection_id: collectionId,
      provider_id,
      /**
       * 🔴 From the CART, falling back to the authenticated caller — not the
       * other way round, and never auth alone.
       *
       * `auth_context.actor_id` is undefined for a guest, and a B2B quote
       * buyer is deliberately a guest. That made the account holder — and so
       * the saved card — impossible for exactly the buyers we want to keep a
       * card for. See `resolveCollectionCustomerId`.
       */
      customer_id: cartCustomerId ?? (req as any).auth_context?.actor_id,
      /**
       * The save-card flag is decided HERE, not accepted from the caller.
       *
       * A storefront that forgot to ask would silently lose the card, and the
       * loss would not surface until the balance was due weeks later. The
       * server knows whether a balance follows — so the server says so, and a
       * caller-supplied value cannot turn it off.
       */
      data: { ...(data ?? {}), ...(plan ? saveCardSessionData(plan) : {}) },
      ...(context ? { context } : {}),
    },
  })

  const paymentCollection = await refetchEntity({
    entity: "payment_collection",
    idOrFilter: collectionId,
    scope: req.scope,
    fields: req.queryConfig?.fields ?? DEFAULT_FIELDS,
  })

  res.status(200).json({ payment_collection: paymentCollection })
}
