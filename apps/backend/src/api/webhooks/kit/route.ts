import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { parseKitSuppression } from "../../../modules/email_suppression/provider-parsers"
import { suppressEmail } from "../../../modules/email_suppression/suppress-core"
import { parseKitEngagement } from "../../../modules/email_engagement/provider-parsers"
import { recordEngagement } from "../../../modules/email_engagement/engagement-core"

/**
 * POST /webhooks/kit?event=<kind>
 *
 * Kit (kit.com) webhook sink for the mass blog/newsletter lane. Kit does NOT
 * carry the event kind in the payload, so each Kit webhook rule is registered
 * against a distinct `?event=` target URL (see the setup route):
 *   bounce | complain | unsubscribe  → auto-suppress the recipient across
 *                                       person/customer/lead + audit row.
 *   click                            → fold into the engagement ledger.
 * (Opens have no Kit webhook — polled via broadcast stats instead.)
 *
 * Kit does not HMAC-sign payloads, so the endpoint is gated by a shared secret:
 * set `KIT_WEBHOOK_SECRET` and append `?token=<secret>` (or header
 * `x-webhook-token: <secret>`) on the registered target URL. When the env is
 * unset the gate is open (dev only) and a warning is logged.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const secret = process.env.KIT_WEBHOOK_SECRET
  if (secret) {
    const provided =
      (req.query?.token as string) || (req.headers["x-webhook-token"] as string) || ""
    if (provided !== secret) {
      logger.warn("[Kit Webhook] Rejected — bad or missing token")
      return res.status(401).send("Unauthorized")
    }
  } else {
    logger.warn("[Kit Webhook] KIT_WEBHOOK_SECRET not set — gate is open")
  }

  const kind = String(req.query?.event || "").toLowerCase()
  const body = req.body as any

  // Process before acking. Kit posts one low-volume event per call, so the work
  // is cheap; doing it inline (rather than fire-and-forget) keeps the request
  // scope alive for the DB writes and lets Kit retry on a genuine 5xx failure.
  try {
    await processKitEvent(req.scope, kind, body)
  } catch (error) {
    logger.error("[Kit Webhook] Failed to process event:", error as Error)
    return res.status(500).send("Error")
  }

  return res.status(200).send("OK")
}

async function processKitEvent(scope: any, kind: string, body: any): Promise<void> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)

  if (kind === "click") {
    const engagement = parseKitEngagement(body)
    for (const ev of engagement) {
      const outcome = await recordEngagement(scope, {
        email: ev.email,
        type: ev.type,
        provider: "kit",
        event_id: ev.event_id,
        event_at: ev.event_at,
        message_id: ev.message_id,
        raw: ev,
      })
      logger.info(
        `[Kit Webhook] engagement ${ev.type} ${ev.email} → recorded=${outcome.recorded}${outcome.duplicate ? " [dup]" : ""}`
      )
    }
    return
  }

  const items = parseKitSuppression(body, kind)
  if (!items.length) {
    logger.info(`[Kit Webhook] No actionable event for kind='${kind}'`)
    return
  }
  for (const item of items) {
    const outcome = await suppressEmail(scope, {
      email: item.email,
      reason: item.reason,
      provider: "kit",
      event_id: item.event_id,
      event_at: item.event_at,
      raw: item,
    })
    logger.info(
      `[Kit Webhook] ${item.reason} ${item.email} → suppressed=${outcome.suppressed} (p:${outcome.persons} c:${outcome.customers} l:${outcome.leads})${outcome.duplicate ? " [dup]" : ""}`
    )
  }
}
