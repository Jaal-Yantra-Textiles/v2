import { MedusaContainer } from "@medusajs/framework/types"

import { INBOUND_EMAIL_MODULE } from "../../../modules/inbound_emails"
import { SOCIALS_MODULE } from "../../../modules/socials"
import {
  createImapSyncService,
  getImapSyncService,
  ImapSyncService,
  ParsedEmail,
} from "../../../utils/imap-sync"

export type ImapPlatform = { id: string; name: string; api_config: Record<string, any> }

export type SyncImapResult = {
  synced: number
  skipped: number
  total_fetched: number
  providers_synced: number
  errors?: string[]
}

/** Active email platforms whose provider is IMAP (the iCloud mailbox). */
export async function listActiveImapPlatforms(container: MedusaContainer): Promise<ImapPlatform[]> {
  try {
    const socials = container.resolve(SOCIALS_MODULE) as any
    const platforms = await socials.listSocialPlatforms({ category: "email", status: "active" })
    return (platforms ?? []).filter((p: any) => p.api_config?.provider === "imap")
  } catch {
    // socials module unavailable — callers fall back to env vars
    return []
  }
}

/**
 * #2377 S1 — the mailboxes a platform reads. `api_config.mailboxes` (iCloud
 * rules sort company mail into several folders) wins; the single `mailbox`
 * of older rows still works; INBOX when neither is set.
 */
export function platformMailboxes(apiConfig: Record<string, any> | null | undefined): string[] {
  const list = Array.isArray(apiConfig?.mailboxes)
    ? apiConfig!.mailboxes
    : typeof apiConfig?.mailboxes === "string"
      ? apiConfig!.mailboxes.split(",")
      : apiConfig?.mailbox
        ? [apiConfig.mailbox]
        : ["INBOX"]
  const names = list.map((m: unknown) => String(m ?? "").trim()).filter(Boolean)
  return names.length ? [...new Set<string>(names)] : ["INBOX"]
}

/**
 * Already stored? Same uid in the same folder for the same platform, or the
 * same Message-ID in the same folder. The Message-ID check survives an IMAP
 * UIDVALIDITY reset, which renumbers every uid in a mailbox.
 */
export async function isAlreadyStored(
  inboundEmails: any,
  email: ParsedEmail,
  platformId: string | null
): Promise<boolean> {
  const byUid = await inboundEmails.listInboundEmails(
    { imap_uid: String(email.uid), folder: email.folder },
    { select: ["id", "metadata"] }
  )
  if (byUid?.some((e: any) => (platformId ? e.metadata?.platform_id === platformId : true))) {
    return true
  }
  if (email.messageId) {
    const byMessageId = await inboundEmails.listInboundEmails(
      { message_id: email.messageId, folder: email.folder },
      { select: ["id"], take: 1 }
    )
    if (byMessageId?.length) return true
  }
  return false
}

async function storeNew(
  inboundEmails: any,
  emails: ParsedEmail[],
  platform: ImapPlatform | null
): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0
  for (const email of emails) {
    if (await isAlreadyStored(inboundEmails, email, platform?.id ?? null)) {
      skipped++
      continue
    }
    await inboundEmails.createInboundEmails({
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
      ...(platform ? { metadata: { platform_id: platform.id, platform_name: platform.name } } : {}),
    })
    created++
  }
  return { created, skipped }
}

async function syncOne(
  service: ImapSyncService,
  mailboxes: string[],
  count: number,
  inboundEmails: any,
  platform: ImapPlatform | null,
  errors: string[]
): Promise<{ created: number; skipped: number; fetched: number; ok: boolean }> {
  const label = platform?.name ?? "env"
  try {
    await service.connect()
  } catch (err: any) {
    errors.push(`[${label}] Connection failed: ${err.message}`)
    await service.disconnect().catch(() => {})
    return { created: 0, skipped: 0, fetched: 0, ok: false }
  }

  let created = 0
  let skipped = 0
  let fetched = 0
  let ok = true
  try {
    // One bad folder (renamed in iCloud, say) must not stop the others.
    for (const mailbox of mailboxes) {
      try {
        const emails = await service.syncRecent(count, mailbox)
        fetched += emails.length
        const r = await storeNew(inboundEmails, emails, platform)
        created += r.created
        skipped += r.skipped
      } catch (err: any) {
        ok = false
        errors.push(`[${label}/${mailbox}] Sync failed: ${err.message}`)
      }
    }
  } finally {
    await service.disconnect().catch(() => {})
  }
  return { created, skipped, fetched, ok }
}

/**
 * Pull the most recent `count` emails of every mailbox of every active IMAP
 * platform and store the ones we don't have. Shared by the admin Sync button
 * and the 5-minute poll job. Never throws for a single platform's failure;
 * those land in `errors`. Throws only when nothing is configured at all.
 */
export async function syncImapPlatforms(
  container: MedusaContainer,
  opts: { count?: number } = {}
): Promise<SyncImapResult> {
  const count = opts.count ?? 50
  const inboundEmails = container.resolve(INBOUND_EMAIL_MODULE) as any
  const platforms = await listActiveImapPlatforms(container)
  const errors: string[] = []

  let synced = 0
  let skipped = 0
  let fetched = 0
  let providersOk = 0

  if (platforms.length === 0) {
    // Env-var fallback (a single provider).
    const env = getImapSyncService()
    if (!env.isConfigured()) {
      throw new Error("No IMAP email providers configured. Add one under External Platforms → Email.")
    }
    const r = await syncOne(env, env.getMailboxes(), count, inboundEmails, null, errors)
    return {
      synced: r.created,
      skipped: r.skipped,
      total_fetched: r.fetched,
      providers_synced: r.ok ? 1 : 0,
      ...(errors.length ? { errors } : {}),
    }
  }

  for (const platform of platforms) {
    const service = createImapSyncService(platform.api_config)
    const r = await syncOne(
      service,
      platformMailboxes(platform.api_config),
      count,
      inboundEmails,
      platform,
      errors
    )
    synced += r.created
    skipped += r.skipped
    fetched += r.fetched
    if (r.ok) providersOk++
  }

  return {
    synced,
    skipped,
    total_fetched: fetched,
    providers_synced: providersOk,
    ...(errors.length ? { errors } : {}),
  }
}
