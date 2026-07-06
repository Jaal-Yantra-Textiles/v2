import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Webhook } from "svix"

import { SOCIALS_MODULE } from "../../../../modules/socials"
import { ENCRYPTION_MODULE } from "../../../../modules/encryption"
import type EncryptionService from "../../../../modules/encryption/service"
import type { EncryptedData } from "../../../../modules/encryption"
import { parseResendEvent } from "../../../../modules/email_suppression/provider-parsers"
import { suppressEmail } from "../../../../modules/email_suppression/suppress-core"
import { parseResendEngagement } from "../../../../modules/email_engagement/provider-parsers"
import { recordEngagement } from "../../../../modules/email_engagement/engagement-core"
import { bridgeOutreachEngagement } from "../../../../modules/marketing/bridge-engagement"

/**
 * POST /webhooks/resend/email-events
 *
 * Resend delivery-event webhook (Svix-signed). Handles `email.bounced` and
 * `email.complained` → auto-suppresses the recipient across person/customer/lead
 * and writes an `email_suppression` audit row. Distinct from the inbound-email
 * webhook (`/webhooks/inbound-email/resend`, which handles `email.received`).
 *
 * Reuses the same signing secret stored on the Resend SocialPlatform config, so
 * point Resend's bounce/complaint events at this URL with the same secret.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  // Raw body for signature verification.
  let rawBody = ""
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk) => {
      rawBody += chunk.toString("utf8")
    })
    req.on("end", () => resolve())
    req.on("error", (err) => reject(err))
  })

  // Signing secret from the active Resend email platform config.
  const socialsService = req.scope.resolve(SOCIALS_MODULE) as any
  const platforms = await socialsService.listSocialPlatforms({})
  const resendPlatform = platforms.find(
    (p: any) =>
      p.category === "email" &&
      p.status === "active" &&
      (p.api_config as any)?.provider === "resend"
  )
  if (!resendPlatform) {
    logger.error("[Resend Events] No active Resend email provider configured")
    return res.status(404).send("Resend provider not configured")
  }

  const apiConfig = resendPlatform.api_config as Record<string, any>
  let signingSecret: string
  if (apiConfig.webhook_signing_secret_encrypted) {
    const encryptionService = req.scope.resolve(ENCRYPTION_MODULE) as EncryptionService
    signingSecret = encryptionService.decrypt(
      apiConfig.webhook_signing_secret_encrypted as EncryptedData
    )
  } else if (apiConfig.webhook_signing_secret) {
    signingSecret = apiConfig.webhook_signing_secret
  } else {
    logger.error("[Resend Events] No webhook signing secret configured")
    return res.status(500).send("Webhook signing secret not configured")
  }

  const svixId = req.headers["svix-id"] as string
  const svixTimestamp = req.headers["svix-timestamp"] as string
  const svixSignature = req.headers["svix-signature"] as string
  if (!svixId || !svixTimestamp || !svixSignature) {
    return res.status(401).send("Missing signature headers")
  }

  let payload: any
  try {
    const wh = new Webhook(signingSecret)
    payload = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as any
  } catch (err: any) {
    logger.error("[Resend Events] Signature verification failed:", err?.message)
    return res.status(401).send("Invalid signature")
  }

  // Ack immediately, process async (Resend retries on non-2xx).
  res.status(200).send("OK")

  processResendDeliveryEvent(req.scope, payload).catch((error) => {
    logger.error("[Resend Events] Failed to process event:", error as Error)
  })
}

async function processResendDeliveryEvent(scope: any, payload: any): Promise<void> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const items = parseResendEvent(payload)
  const engagement = parseResendEngagement(payload)
  if (!items.length && !engagement.length) {
    logger.info(`[Resend Events] Ignoring event type: ${payload?.type}`)
    return
  }
  // Suppression events (email.bounced / email.complained).
  for (const item of items) {
    const outcome = await suppressEmail(scope, {
      email: item.email,
      reason: item.reason,
      provider: "resend",
      event_id: item.event_id,
      event_at: item.event_at,
      raw: payload,
    })
    logger.info(
      `[Resend Events] ${item.reason} ${item.email} → suppressed=${outcome.suppressed} (p:${outcome.persons} c:${outcome.customers} l:${outcome.leads})${outcome.duplicate ? " [dup]" : ""}`
    )
  }
  // Engagement events (email.delivered / email.opened / email.clicked) — fold
  // into the ledger and (Option C) feed any matching marketing_outreach row.
  for (const ev of engagement) {
    const outcome = await recordEngagement(scope, {
      email: ev.email,
      type: ev.type,
      provider: "resend",
      event_id: ev.event_id,
      event_at: ev.event_at,
      message_id: ev.message_id,
      raw: payload,
    })
    const bridged = await bridgeOutreachEngagement(scope, {
      type: ev.type,
      message_id: ev.message_id,
      event_at: ev.event_at,
    }).catch(() => ({ matched: 0, changed: 0 }))
    logger.info(
      `[Resend Events] engagement ${ev.type} ${ev.email} → recorded=${outcome.recorded}${outcome.duplicate ? " [dup]" : ""}${bridged.changed ? ` [outreach:${bridged.changed}]` : ""}`
    )
  }
}
