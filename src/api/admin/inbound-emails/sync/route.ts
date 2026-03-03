import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { createImapSyncService, getImapSyncService } from "../../../../utils/imap-sync"
import { INBOUND_EMAIL_MODULE } from "../../../../modules/inbound_emails"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import { SyncInboundEmailsBody } from "../validators"

export const POST = async (
  req: MedusaRequest<SyncInboundEmailsBody>,
  res: MedusaResponse
) => {
  const body = (req.validatedBody || req.body) as SyncInboundEmailsBody
  const count = body?.count || 50

  const inboundEmailService = req.scope.resolve(INBOUND_EMAIL_MODULE) as any

  // Load all configured email platforms
  let imapPlatforms: Array<{ id: string; name: string; api_config: Record<string, any> }> = []
  try {
    const socialsService = req.scope.resolve(SOCIALS_MODULE) as any
    const platforms = await socialsService.listSocialPlatforms({ category: "email", status: "active" })
    imapPlatforms = platforms.filter(
      (p: any) => (p.api_config as Record<string, any>)?.provider === "imap"
    )
  } catch {
    // socials module unavailable — fall back to env vars below
  }

  // If no DB platforms found, fall back to env-var configured singleton
  if (imapPlatforms.length === 0) {
    const envService = getImapSyncService()
    if (!envService.isConfigured()) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "No IMAP email providers configured. Add one under External Platforms → Email."
      )
    }

    try {
      await envService.connect()
    } catch (err: any) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `IMAP connection failed: ${err.message}`
      )
    }

    const emails = await envService.syncRecent(count)
    await envService.disconnect()

    let created = 0
    let skipped = 0

    for (const email of emails) {
      const existing = await inboundEmailService.listInboundEmails({
        imap_uid: String(email.uid),
        folder: email.folder,
      })
      if (existing?.length) { skipped++; continue }
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
      })
      created++
    }

    return res.status(200).json({ synced: created, skipped, total_fetched: emails.length, providers_synced: 1 })
  }

  // Sync from each configured IMAP platform
  let totalCreated = 0
  let totalSkipped = 0
  let totalFetched = 0
  const errors: string[] = []

  for (const platform of imapPlatforms) {
    const service = createImapSyncService(platform.api_config)

    try {
      await service.connect()
    } catch (err: any) {
      errors.push(`[${platform.name}] Connection failed: ${err.message}`)
      continue
    }

    let emails: any[] = []
    try {
      emails = await service.syncRecent(count)
    } catch (err: any) {
      errors.push(`[${platform.name}] Sync failed: ${err.message}`)
      await service.disconnect().catch(() => {})
      continue
    }

    await service.disconnect().catch(() => {})
    totalFetched += emails.length

    for (const email of emails) {
      // Deduplicate: same UID + folder + platform
      const existing = await inboundEmailService.listInboundEmails({
        imap_uid: String(email.uid),
        folder: email.folder,
      })

      // Filter existing by platform_id stored in metadata
      const isDuplicate = existing?.some(
        (e: any) => e.metadata?.platform_id === platform.id
      )

      if (isDuplicate) { totalSkipped++; continue }

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
        metadata: { platform_id: platform.id, platform_name: platform.name },
      })
      totalCreated++
    }
  }

  res.status(200).json({
    synced: totalCreated,
    skipped: totalSkipped,
    total_fetched: totalFetched,
    providers_synced: imapPlatforms.length - errors.length,
    ...(errors.length ? { errors } : {}),
  })
}
