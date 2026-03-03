import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { createImapSyncService, getImapSyncService, ImapSyncService, ParsedEmail } from "../utils/imap-sync"
import { INBOUND_EMAIL_MODULE } from "../modules/inbound_emails"
import { SOCIALS_MODULE } from "../modules/socials"

// Map of active IMAP services keyed by platform ID (or "env" for env-var fallback)
const activeServices = new Map<string, ImapSyncService>()

let started = false

function makeEmailHandler(
  container: SubscriberArgs<any>["container"],
  logger: Logger,
  platformId: string,
  platformName: string
) {
  return async (email: ParsedEmail) => {
    try {
      const inboundEmailService = container.resolve(INBOUND_EMAIL_MODULE) as any
      await inboundEmailService.createInboundEmails({
        imap_uid: String(email.uid),
        message_id: email.messageId,
        from_address: email.from,
        to_addresses: email.to,
        subject: email.subject,
        html_body: email.htmlBody,
        text_body: email.textBody,
        folder: email.folder,
        received_at: email.receivedAt,
        status: "received",
        metadata: { platform_id: platformId, platform_name: platformName },
      })
      logger.info(`[IMAP:${platformName}] Stored email: "${email.subject}" from ${email.from}`)
    } catch (err: any) {
      logger.error(`[IMAP:${platformName}] Failed to store email: ${err.message}`)
    }
  }
}

export default async function imapSyncHandler({
  container,
}: SubscriberArgs<Record<string, unknown>>) {
  if (started) return
  started = true

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  // Load all active IMAP email platforms from DB
  let imapPlatforms: Array<{ id: string; name: string; api_config: Record<string, any> }> = []
  try {
    const socialsService = container.resolve(SOCIALS_MODULE) as any
    const platforms = await socialsService.listSocialPlatforms({ category: "email", status: "active" })
    imapPlatforms = platforms.filter(
      (p: any) => (p.api_config as Record<string, any>)?.provider === "imap"
    )
    logger.info(`[IMAP] Found ${imapPlatforms.length} active IMAP platform(s)`)
  } catch (err: any) {
    logger.warn(`[IMAP] Failed to load platforms from DB: ${err.message}`)
  }

  // Start a listener for each IMAP platform
  for (const platform of imapPlatforms) {
    const handler = makeEmailHandler(container, logger, platform.id, platform.name)
    const service = createImapSyncService(platform.api_config, handler)

    try {
      await service.connect()
      await service.startIdle()
      activeServices.set(platform.id, service)
      logger.info(`[IMAP:${platform.name}] Listening for new emails`)
    } catch (err: any) {
      logger.error(`[IMAP:${platform.name}] Failed to start: ${err.message}`)
    }
  }

  // Fall back to env vars only if no DB platforms found
  if (imapPlatforms.length === 0) {
    const envService = getImapSyncService(
      makeEmailHandler(container, logger, "env", "env")
    )

    if (!envService.isConfigured()) {
      logger.info("[IMAP] Not configured (no active platforms and no IMAP env vars), skipping")
      return
    }

    try {
      await envService.connect()
      await envService.startIdle()
      activeServices.set("env", envService)
      logger.info("[IMAP] Listening via env-var config")
    } catch (err: any) {
      logger.error(`[IMAP] Failed to start (env): ${err.message}`)
    }
  }
}

export const config: SubscriberConfig = {
  event: "LinkModule.attached",
}
