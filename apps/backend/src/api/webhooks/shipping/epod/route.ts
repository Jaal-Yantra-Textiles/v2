import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { normalizeDelhiveryEpod } from "../../../../modules/shipping-providers/delhivery/client"
import { storeShipmentPodWorkflow } from "../../../../workflows/orders/store-shipment-pod"

/**
 * POST /webhooks/shipping/epod?carrier=delhivery
 *
 * Electronic proof-of-delivery receiver, the sibling of
 * `/webhooks/shipping/track`. Delhivery push a POD document once a shipment is
 * delivered; it is stored against the inventory shipment or core-order
 * fulfillment that owns the AWB.
 *
 * Same gate as the tracking webhook — `SHIPPING_WEBHOOK_SECRET` compared
 * against `x-webhook-token` / `x-api-key` / `?token=`. Delhivery sign nothing,
 * so a shared secret configured on their side is the only credential available.
 *
 * Same contract too: answer 200 fast, before any processing. A POD can be
 * several megabytes of base64, and uploading it to our file store takes far
 * longer than the 500 ms Delhivery allow before they time out and drop the
 * push.
 *
 * Delhivery re-push a POD whenever their audit team uploads a corrected one, so
 * repeat pushes for one AWB are expected; the workflow appends rather than
 * overwrites.
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
      logger.warn("[EPOD Webhook] Rejected — bad or missing token")
      return res.status(401).send("Unauthorized")
    }
  } else {
    logger.warn("[EPOD Webhook] SHIPPING_WEBHOOK_SECRET not set — gate is open")
  }

  const body = req.body as any
  const carrier = String((req.query?.carrier as string) || "delhivery")

  // Ack before processing — the upload is far slower than their timeout.
  res.status(200).send("OK")

  processEpodPush(req.scope, carrier, body).catch((error) => {
    logger.error("[EPOD Webhook] Failed to process push:", error as Error)
  })
}

/** POD payload normalizers by `?carrier=`. Delhivery is the only source today. */
const NORMALIZERS: Record<string, (body: any) => any> = {
  delhivery: normalizeDelhiveryEpod,
}

async function processEpodPush(
  scope: any,
  carrier: string,
  body: any
): Promise<void> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)

  const normalizer = NORMALIZERS[carrier]
  if (!normalizer) {
    logger.warn(`[EPOD Webhook] No normalizer for carrier "${carrier}" — push ignored`)
    return
  }

  const pod = normalizer(body)
  if (!pod.awb) {
    logger.info("[EPOD Webhook] Push without an AWB — ignored (test webhook?)")
    return
  }

  const { result } = await storeShipmentPodWorkflow(scope).run({
    input: { pod: { ...pod, raw: body } },
  })

  if (!result.matched) {
    return
  }

  logger.info(
    `[EPOD Webhook] AWB ${pod.awb}: POD on ${result.target} ${result.target_id}` +
      (result.ephemeral
        ? " (carrier link — EXPIRES in 7 days, not mirrored to our store)"
        : "")
  )
}
