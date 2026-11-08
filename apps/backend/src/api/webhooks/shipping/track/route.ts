import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { normalizeDelhiveryWebhook } from "../../../../modules/shipping-providers/delhivery/client"
import { normalizeShiprocketWebhook } from "../../../../modules/shipping-providers/shiprocket/client"
import { syncInventoryShipmentTrackingWorkflow } from "../../../../workflows/inventory_orders/sync-inventory-shipment-tracking"
import { syncOrderShipmentTrackingWorkflow } from "../../../../workflows/orders/sync-order-shipment-tracking"
import { describePushBody, pushPayloads } from "./push-body"

/**
 * POST /webhooks/shipping/track (#888)
 *
 * General-purpose carrier tracking receiver. Today the only push source is
 * Shiprocket (configured account-wide in their dashboard: Settings → API →
 * Webhook); a `?carrier=` param selects the payload normalizer when more
 * carriers arrive. The path deliberately contains none of the substrings
 * Shiprocket's URL validator blocks (`shiprocket`, `sr`, `kr`).
 *
 * Shiprocket doesn't sign webhooks — it replays a custom header you configure
 * in the dashboard. Gate: set `SHIPPING_WEBHOOK_SECRET` and configure the
 * header `x-webhook-token: <secret>` (or `x-api-key`, or `?token=` on the URL).
 * When the env is unset the gate is open (dev only) and a warning is logged.
 *
 * Contract with Shiprocket: always answer 200 fast (they retry/flag non-200),
 * so the payload is acked first and processed async. Pushes for AWBs we don't
 * know (e.g. core-order shipments until #886 routes them) are logged and
 * swallowed.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const secret = process.env.SHIPPING_WEBHOOK_SECRET
  if (secret) {
    const provided =
      (req.query?.token as string) ||
      (req.headers["x-webhook-token"] as string) ||
      (req.headers["x-api-key"] as string) ||
      ""
    if (provided !== secret) {
      logger.warn("[Shipping Webhook] Rejected — bad or missing token")
      return res.status(401).send("Unauthorized")
    }
  } else {
    logger.warn("[Shipping Webhook] SHIPPING_WEBHOOK_SECRET not set — gate is open")
  }

  const carrier = String((req.query?.carrier as string) || "shiprocket")
  const contentType = String(req.headers["content-type"] || "")
  // A content type none of Medusa's parsers claim (octet-stream, none at all)
  // leaves the stream unread — read it here, before the ack ends the request.
  const rawBody = (req as any).rawBody ?? (await readUnparsedBody(req))
  const body = req.body as any

  // Ack immediately; process async (Shiprocket requires a fast 200).
  res.status(200).send("OK")

  processTrackingPushes(req.scope, carrier, body, rawBody, contentType).catch((error) => {
    logger.error("[Shipping Webhook] Failed to process push:", error as Error)
  })
}

/**
 * Payload normalizers by `?carrier=`. Both produce the same `TrackingResult`
 * shape, so everything downstream (AWB match → inventory shipment → core order)
 * is carrier-agnostic.
 *
 * Delhivery's push is live (their team enabled it for
 * `?carrier=delhivery` in Oct 2026); the hourly poll in
 * `jobs/poll-delhivery-tracking` is the safety net behind it. Both paths feed
 * the same workflows, so a missed push only costs latency.
 */
const NORMALIZERS: Record<string, (body: any) => any> = {
  shiprocket: normalizeShiprocketWebhook,
  delhivery: normalizeDelhiveryWebhook,
}

/** Cap on a body we read ourselves — a status push is a few hundred bytes. */
const MAX_UNPARSED_BYTES = 1024 * 1024

async function readUnparsedBody(req: MedusaRequest): Promise<Buffer | undefined> {
  const stream: any = req
  if (req.body != null && !isEmptyObject(req.body)) return undefined
  if (!stream.readable || stream.readableEnded) return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > MAX_UNPARSED_BYTES) break
    chunks.push(Buffer.from(chunk))
  }
  return chunks.length ? Buffer.concat(chunks) : undefined
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.keys(value).length === 0
}

async function processTrackingPushes(
  scope: any,
  carrier: string,
  body: any,
  rawBody: unknown,
  contentType: string
): Promise<void> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)

  // Unknown carriers are logged, not 4xx'd (the ack already went out, and a
  // misconfigured query param shouldn't make the carrier retry-storm us).
  const normalizer = NORMALIZERS[carrier]
  if (!normalizer) {
    logger.warn(`[Shipping Webhook] No normalizer for carrier "${carrier}" — push ignored`)
    return
  }

  const payloads = pushPayloads(body, rawBody)
  const trackings = payloads.map((p) => normalizer(p)).filter((t) => !!t?.awb)
  if (!trackings.length) {
    // Never drop an update silently again: record its shape so the next one
    // shows exactly what the carrier sent.
    logger.warn(
      `[Shipping Webhook] ${carrier} push without an AWB — ignored. ` +
        describePushBody(rawBody ?? body, contentType)
    )
    return
  }

  for (const tracking of trackings) {
    try {
      await processTrackingPush(scope, tracking)
    } catch (error) {
      logger.error(`[Shipping Webhook] Failed to process AWB ${tracking.awb}:`, error as Error)
    }
  }
}

async function processTrackingPush(scope: any, tracking: any): Promise<void> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = tracking.raw

  const { result } = await syncInventoryShipmentTrackingWorkflow(scope).run({
    input: { tracking: { ...tracking, raw: body } },
  })

  if (result.matched) {
    logger.info(
      `[Shipping Webhook] AWB ${tracking.awb}: shipment ${result.shipment_id} ` +
        `${result.previous_shipment_status}→${result.shipment_status}` +
        (result.shipment_status_changed ? "" : " (no change)") +
        (result.order_status_changed
          ? ` · order ${result.order_id} ${result.previous_order_status}→${result.order_status}`
          : "")
    )
    return
  }

  // Not an inventory shipment — try the retail/core-order path (#1111). The
  // account-level webhook carries both; core shipments store the AWB on a
  // fulfillment_label (domestic + international alike).
  const { result: orderResult } = await syncOrderShipmentTrackingWorkflow(scope).run({
    input: { tracking: { ...tracking, raw: body } },
  })

  if (!orderResult.matched) {
    logger.info(
      `[Shipping Webhook] AWB ${tracking.awb} matched no inventory or core-order shipment (status "${tracking.current_status}") — ignored`
    )
    return
  }
  logger.info(
    `[Shipping Webhook] AWB ${tracking.awb}: core fulfillment ${orderResult.fulfillment_id} ` +
      `(order ${orderResult.order_id}) → ${orderResult.synced_state}` +
      (orderResult.status_changed ? "" : " (no change)")
  )
}
