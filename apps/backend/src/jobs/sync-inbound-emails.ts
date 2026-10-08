import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { syncImapPlatforms } from "../workflows/inbound-emails/lib/sync-imap-platforms"

/**
 * #2377 S1 — bring new company email into the admin Inbox.
 *
 * Every 5 minutes, read the most recent emails of every mailbox of every
 * active IMAP platform (the iCloud account all @jaalyantra.com mail lands in;
 * iCloud rules sort it into folders) and store the new ones.
 *
 * This replaces an IMAP IDLE listener that waited on a `LinkModule.attached`
 * event nothing emits, so it never ran in prod: every stored email before this
 * came from the admin Sync button.
 *
 * Idempotent: an email already stored (same uid+folder+platform, or same
 * Message-ID in the folder) is skipped. Polling, not IDLE, because a held-open
 * IMAP connection in a container dies quietly; a fresh connection each run
 * cannot. Kill switch: INBOUND_EMAIL_SYNC=false.
 */
const COUNT = Number(process.env.INBOUND_EMAIL_SYNC_COUNT || 30)

export default async function syncInboundEmailsJob(container: MedusaContainer) {
  if (process.env.INBOUND_EMAIL_SYNC === "false") return
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const result = await syncImapPlatforms(container, { count: COUNT })
    if (result.synced > 0 || result.errors?.length) {
      logger.info(
        `[inbound-email-sync] stored ${result.synced} new, skipped ${result.skipped}, ` +
          `fetched ${result.total_fetched}` +
          (result.errors?.length ? `; errors: ${result.errors.join(" | ")}` : "")
      )
    }
  } catch (err: any) {
    // Nothing configured is the only throw; say so once per run, quietly.
    logger.warn(`[inbound-email-sync] skipped: ${err.message}`)
  }
}

export const config = {
  name: "sync-inbound-emails",
  schedule: "*/5 * * * *", // every 5 minutes
}
