import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { parseMailjetEvents } from "../../../../modules/email_suppression/provider-parsers"
import { suppressEmail } from "../../../../modules/email_suppression/suppress-core"

/**
 * POST /webhooks/mailjet/events
 *
 * Mailjet Event API (triggers) webhook. Handles bounce / blocked / spam / unsub
 * → auto-suppresses the recipient across person/customer/lead + writes an
 * `email_suppression` audit row.
 *
 * Mailjet does not HMAC-sign payloads, so the endpoint is gated by a shared
 * secret: set `MAILJET_WEBHOOK_SECRET` and append `?token=<secret>` (or send
 * header `x-webhook-token: <secret>`) on the Mailjet event trigger URL. When the
 * env is unset the gate is open (dev only) and a warning is logged.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const secret = process.env.MAILJET_WEBHOOK_SECRET
  if (secret) {
    const provided =
      (req.query?.token as string) || (req.headers["x-webhook-token"] as string) || ""
    if (provided !== secret) {
      logger.warn("[Mailjet Events] Rejected — bad or missing token")
      return res.status(401).send("Unauthorized")
    }
  } else {
    logger.warn("[Mailjet Events] MAILJET_WEBHOOK_SECRET not set — gate is open")
  }

  const body = req.body as any
  const items = parseMailjetEvents(body)

  // Ack immediately; process async (Mailjet retries on non-2xx).
  res.status(200).send("OK")

  processMailjetEvents(req.scope, body, items).catch((error) => {
    logger.error("[Mailjet Events] Failed to process events:", error as Error)
  })
}

async function processMailjetEvents(scope: any, body: any, items: any[]): Promise<void> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  if (!items.length) {
    logger.info("[Mailjet Events] No actionable events in payload")
    return
  }
  for (const item of items) {
    const outcome = await suppressEmail(scope, {
      email: item.email,
      reason: item.reason,
      provider: "mailjet",
      event_id: item.event_id,
      event_at: item.event_at,
      raw: item,
    })
    logger.info(
      `[Mailjet Events] ${item.reason} ${item.email} → suppressed=${outcome.suppressed} (p:${outcome.persons} c:${outcome.customers} l:${outcome.leads})${outcome.duplicate ? " [dup]" : ""}`
    )
  }
}
