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

const DEFAULT_FIELDS = ["id", "currency_code", "amount", "*payment_sessions"]

/**
 * Override of the core store payment-sessions route
 * (POST /store/payment-collections/:id/payment-sessions).
 *
 * Behaviourally identical to core, EXCEPT that for PayU we resolve the
 * storefront's owning partner's merchant credentials UPSTREAM here — where
 * `query` and other modules are available — and pass them to the provider via
 * the payment-session `context`. The PayU provider runs in an isolated module
 * container and cannot resolve the partner itself; without this it silently
 * fell back to the platform's global PayU credentials, i.e. a partner's sale
 * would be charged into JYT's own PayU account. Mirrors the Stripe Connect
 * `resolvePartnerConnect` → context pattern.
 *
 * Resolution is best-effort: no partner / no active PayU config → empty context
 * → provider keeps using the global credentials (unchanged legacy behaviour).
 * Only PayU sessions incur the extra lookups.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const collectionId = req.params.id
  const { provider_id, data } = req.body as {
    provider_id: string
    data?: Record<string, unknown>
  }

  let context: Record<string, unknown> | undefined
  if (String(provider_id || "").includes("payu")) {
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
  }

  await createPaymentSessionsWorkflow(req.scope).run({
    input: {
      payment_collection_id: collectionId,
      provider_id,
      customer_id: (req as any).auth_context?.actor_id,
      data,
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
