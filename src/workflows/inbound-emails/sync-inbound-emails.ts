import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows"
import { MedusaError } from "@medusajs/framework/utils"
import { createImapSyncService, getImapSyncService } from "../../utils/imap-sync"
import { INBOUND_EMAIL_MODULE } from "../../modules/inbound_emails"
import { SOCIALS_MODULE } from "../../modules/socials"

type SyncInboundEmailsInput = {
  count?: number
}

type SyncResult = {
  synced: number
  skipped: number
  total_fetched: number
  providers_synced: number
  errors?: string[]
}

// Step 1: Load configured IMAP platforms from DB or env vars
const loadImapPlatformsStep = createStep(
  "load-imap-platforms",
  async (input: SyncInboundEmailsInput, { container }) => {
    let imapPlatforms: Array<{ id: string; name: string; api_config: Record<string, any> }> = []

    try {
      const socialsService = container.resolve(SOCIALS_MODULE) as any
      const platforms = await socialsService.listSocialPlatforms({ category: "email", status: "active" })
      imapPlatforms = platforms.filter(
        (p: any) => (p.api_config as Record<string, any>)?.provider === "imap"
      )
    } catch {
      // socials module unavailable — fall back to env vars
    }

    // Fall back to env-var configured singleton if no DB platforms
    const useEnvFallback = imapPlatforms.length === 0

    if (useEnvFallback) {
      const envService = getImapSyncService()
      if (!envService.isConfigured()) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "No IMAP email providers configured. Add one under External Platforms → Email."
        )
      }
    }

    return new StepResponse({ imapPlatforms, useEnvFallback })
  }
)

// Step 2: Sync emails from all platforms and persist new ones
const syncEmailsFromPlatformsStep = createStep(
  "sync-emails-from-platforms",
  async (
    input: {
      count: number
      imapPlatforms: Array<{ id: string; name: string; api_config: Record<string, any> }>
      useEnvFallback: boolean
    },
    { container }
  ) => {
    const inboundEmailService = container.resolve(INBOUND_EMAIL_MODULE) as any
    const { count, imapPlatforms, useEnvFallback } = input

    // Env-var fallback path (single provider)
    if (useEnvFallback) {
      const envService = getImapSyncService()

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

      return new StepResponse({
        synced: created,
        skipped,
        total_fetched: emails.length,
        providers_synced: 1,
      } as SyncResult)
    }

    // Multi-platform DB path
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
        const existing = await inboundEmailService.listInboundEmails({
          imap_uid: String(email.uid),
          folder: email.folder,
        })

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

    return new StepResponse({
      synced: totalCreated,
      skipped: totalSkipped,
      total_fetched: totalFetched,
      providers_synced: imapPlatforms.length - errors.length,
      ...(errors.length ? { errors } : {}),
    } as SyncResult)
  }
)

export const syncInboundEmailsWorkflow = createWorkflow(
  "sync-inbound-emails",
  (input: SyncInboundEmailsInput) => {
    const count = input.count ?? 50

    const failureNotification = transform({ input }, (data) => [
      {
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: {
          title: "Inbound Email Sync Failed",
          description: `Failed to sync inbound emails (requested ${data.input.count ?? 50} emails).`,
        },
      },
    ])
    notifyOnFailureStep(failureNotification)

    const { imapPlatforms, useEnvFallback } = loadImapPlatformsStep({ count })

    const result = syncEmailsFromPlatformsStep({ count, imapPlatforms, useEnvFallback })

    const successNotification = transform({ result }, (data) => [
      {
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: {
          title: "Inbound Email Sync Complete",
          description: `Synced ${data.result.synced} new email(s), skipped ${data.result.skipped} duplicate(s) across ${data.result.providers_synced} provider(s).`,
        },
      },
    ])
    sendNotificationsStep(successNotification)

    return new WorkflowResponse(result)
  }
)
