import crypto from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { FAIRE_SYNC_MODULE } from "../../../modules/faire-sync"
import FaireSyncService from "../../../modules/faire-sync/service"
import { verifyFaireWebhook } from "../../../lib/webhook"

/**
 * POST /webhooks/faire — inbound Faire webhook receiver.
 *
 * Faire signs each delivery with an HMAC-SHA256 of the raw body using the
 * webhook secret shared at registration time, sent in the
 * `X-Faire-Webhook-Signature` header. This route:
 *   1. verifies the signature over the raw body,
 *   2. records the delivery idempotently (unique delivery id),
 *   3. best-effort fetches the resource referenced and re-emits a Medusa event
 *      `faire.<event_type>` so subscribers / visual flows can act on it,
 *   4. always returns 200 once verified+recorded (Faire retries on non-2xx).
 *
 * Raw body is available because the host's middlewares.ts sets preserveRawBody
 * for this path. Register the endpoint URL + copy the signing secret
 * (FAIRE_WEBHOOK_SECRET) when you create the webhook via the Faire API.
 *
 * Faire emits events such as ORDER_PLACED, ORDER_CANCELED, ORDER_SHIPPED,
 * INVENTORY_UPDATED, PRODUCT_UPDATED (verify against your Faire app's
 * configuration). We normalize the event_type to lowercase for the emitted
 * Medusa event name.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as any
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const secret = (service.getOptions() as any).webhookSecret as string

  const rawBody = (req as any).rawBody as Buffer | undefined
  const rawStr = rawBody?.length ? rawBody.toString("utf8") : JSON.stringify(req.body ?? {})

  const headers = {
    signature: req.headers["x-faire-webhook-signature"] as string | undefined,
    timestamp: req.headers["x-faire-webhook-timestamp"] as string | undefined,
  }

  const { valid, reason } = verifyFaireWebhook({ secret, headers, rawBody: rawStr })
  if (!valid) {
    logger?.warn?.(`[faire-webhook] rejected: ${reason}`)
    return res.status(401).json({ error: "invalid signature" })
  }

  const payload: any = req.body ?? safeParse(rawStr)
  const eventType: string = String(
    payload?.event_type || payload?.type || "unknown"
  ).toLowerCase()

  // Delivery id — Faire sends a unique id per delivery; fall back to a hash of
  // the body + type so we still dedupe if absent.
  const webhookId =
    (req.headers["x-faire-webhook-id"] as string | undefined) ||
    (payload?.webhook_id as string | undefined) ||
    `${eventType}:${crypto.createHash("sha256").update(rawStr).digest("hex")}`

  // Idempotency — Faire retries with backoff; a verified duplicate is a no-op.
  const existing = await service
    .listFaireWebhookEvents({ webhook_id: webhookId } as any)
    .catch(() => [])
  if ((existing as any[])?.length) {
    return res.status(200).json({ ok: true, duplicate: true })
  }

  let record: any
  try {
    record = await service.createFaireWebhookEvents({
      webhook_id: webhookId,
      event_type: eventType,
      brand_id: payload?.brand_id != null ? String(payload.brand_id) : null,
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
      const account = await service.getActiveAccount()
      if (account) {
        resource = await service
          .getClient()
          .fetchResource(account.access_token, payload.resource_url)
          .catch(() => null)
      }
    } else if (payload?.data) {
      resource = payload.data
    }

    const eventBus: any = req.scope.resolve(Modules.EVENT_BUS)
    await eventBus.emit({
      name: `faire.${eventType}`,
      data: {
        webhook_id: webhookId,
        event_type: eventType,
        brand_id: payload?.brand_id ?? null,
        resource_url: payload?.resource_url ?? null,
        resource,
      },
    })

    await service.updateFaireWebhookEvents({
      id: record.id,
      resource,
      processed: true,
    } as any)
  } catch (err: any) {
    logger?.warn?.(
      `[faire-webhook] processing failed for ${webhookId}: ${err?.message || err}`
    )
    await service
      .updateFaireWebhookEvents({ id: record.id, error: String(err?.message || err) } as any)
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
