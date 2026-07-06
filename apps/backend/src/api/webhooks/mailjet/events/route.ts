import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { parseMailjetEvents } from "../../../../modules/email_suppression/provider-parsers"
import { suppressEmail } from "../../../../modules/email_suppression/suppress-core"
import { parseMailjetEngagement } from "../../../../modules/email_engagement/provider-parsers"
import { recordEngagement } from "../../../../modules/email_engagement/engagement-core"
import { bridgeOutreachEngagement } from "../../../../modules/marketing/bridge-engagement"

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
  const engagement = parseMailjetEngagement(body)

  // Ack immediately; process async (Mailjet retries on non-2xx).
  res.status(200).send("OK")

  processMailjetEvents(req.scope, body, items, engagement).catch((error) => {
    logger.error("[Mailjet Events] Failed to process events:", error as Error)
  })
}

async function processMailjetEvents(
  scope: any,
  body: any,
  items: any[],
  engagement: any[]
): Promise<void> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  if (!items.length && !engagement.length) {
    logger.info("[Mailjet Events] No actionable events in payload")
    return
  }
  // Suppression events (bounce/blocked/spam/unsub) — take the recipient off the list.
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
  // Engagement events (sent→delivered / open / click) — fold into the ledger
  // and (Option C) feed any matching marketing_outreach campaign row.
  for (const ev of engagement) {
    const outcome = await recordEngagement(scope, {
      email: ev.email,
      type: ev.type,
      provider: "mailjet",
      event_id: ev.event_id,
      event_at: ev.event_at,
      message_id: ev.message_id,
      raw: ev,
    })
    const bridged = await bridgeOutreachEngagement(scope, {
      type: ev.type,
      message_id: ev.message_id,
      event_at: ev.event_at,
    }).catch(() => ({ matched: 0, changed: 0 }))
    logger.info(
      `[Mailjet Events] engagement ${ev.type} ${ev.email} → recorded=${outcome.recorded}${outcome.duplicate ? " [dup]" : ""}${bridged.changed ? ` [outreach:${bridged.changed}]` : ""}`
    )
  }
}
