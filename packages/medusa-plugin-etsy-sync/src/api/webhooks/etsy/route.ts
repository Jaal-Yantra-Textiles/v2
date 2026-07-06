import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ETSY_SYNC_MODULE } from "../../../modules/etsy-sync"
import EtsySyncService from "../../../modules/etsy-sync/service"
import { verifyEtsyWebhook } from "../../../lib/webhook"

/**
 * POST /webhooks/etsy — inbound Etsy webhook receiver (Svix-delivered).
 *
 * Etsy currently emits only order events: order.paid, order.canceled,
 * order.shipped, order.delivered. This route:
 *   1. verifies the HMAC-SHA256 (Svix) signature over the raw body,
 *   2. records the delivery idempotently (unique webhook-id),
 *   3. best-effort fetches the `resource_url` and re-emits a Medusa event
 *      `etsy.<event_type>` so subscribers / visual flows can act on it,
 *   4. always returns 200 once verified+recorded (Etsy retries on non-2xx).
 *
 * Raw body is available because middlewares.ts sets preserveRawBody for this
 * path. Register the endpoint URL + copy the signing secret (ETSY_WEBHOOK_SECRET)
 * from Etsy's Webhooks Portal ("Manage your apps").
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as any
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const secret = (service.getOptions() as any).webhookSecret as string

  const rawBody = (req as any).rawBody as Buffer | undefined
  const rawStr = rawBody?.length ? rawBody.toString("utf8") : JSON.stringify(req.body ?? {})

  const headers = {
    id: req.headers["webhook-id"] as string | undefined,
    timestamp: req.headers["webhook-timestamp"] as string | undefined,
    signature: req.headers["webhook-signature"] as string | undefined,
  }

  const { valid, reason } = verifyEtsyWebhook({ secret, headers, rawBody: rawStr })
  if (!valid) {
    logger?.warn?.(`[etsy-webhook] rejected: ${reason}`)
    return res.status(401).json({ error: "invalid signature" })
  }

  const payload: any = req.body ?? safeParse(rawStr)
  const eventType: string = payload?.event_type || "unknown"
  const webhookId = headers.id as string

  // Idempotency — Etsy retries with backoff; a verified duplicate is a no-op.
  const existing = await service
    .listEtsyWebhookEvents({ webhook_id: webhookId } as any)
    .catch(() => [])
  if ((existing as any[])?.length) {
    return res.status(200).json({ ok: true, duplicate: true })
  }

  let record: any
  try {
    record = await service.createEtsyWebhookEvents({
      webhook_id: webhookId,
      event_type: eventType,
      shop_id: payload?.shop_id != null ? String(payload.shop_id) : null,
      resource_url: payload?.resource_url ?? null,
      payload,
      received_at: new Date(),
    } as any)
  } catch {
    // Unique-constraint race → treat as duplicate.
    return res.status(200).json({ ok: true, duplicate: true })
  }

  // Best-effort processing — never fail the webhook once it's verified+recorded.
  try {
    let resource: any = null
    if (payload?.resource_url) {
      const account = await service.ensureFreshToken()
      resource = await service
        .getClient()
        .fetchResource((account as any).access_token, payload.resource_url)
        .catch(() => null)
    }

    const eventBus: any = req.scope.resolve(Modules.EVENT_BUS)
    await eventBus.emit({
      name: `etsy.${eventType}`,
      data: {
        webhook_id: webhookId,
        event_type: eventType,
        shop_id: payload?.shop_id ?? null,
        resource_url: payload?.resource_url ?? null,
        resource,
      },
    })

    await service.updateEtsyWebhookEvents({
      id: record.id,
      resource,
      processed: true,
    } as any)
  } catch (err: any) {
    logger?.warn?.(`[etsy-webhook] processing failed for ${webhookId}: ${err?.message || err}`)
    await service
      .updateEtsyWebhookEvents({ id: record.id, error: String(err?.message || err) } as any)
      .catch(() => {})
  }

  return res.status(200).json({ ok: true })
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}
