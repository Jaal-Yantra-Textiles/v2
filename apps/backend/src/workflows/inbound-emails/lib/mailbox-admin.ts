import { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import { SOCIALS_MODULE } from "../../../modules/socials"
import { createImapSyncService, ImapMailboxInfo, ImapSyncService } from "../../../utils/imap-sync"
import { ImapPlatform, listActiveImapPlatforms, platformMailboxes } from "./sync-imap-platforms"

/**
 * #2377 — choose which iCloud folders the Inbox reads, and create new ones,
 * from the admin. The choice is `api_config.mailboxes` on the IMAP platform
 * row, the same list the 5-minute sync reads.
 */

export type MailboxRow = ImapMailboxInfo & { reading: boolean }

/** The IMAP platform to act on: the one asked for, else the only one. */
export async function resolveImapPlatform(
  container: MedusaContainer,
  platformId?: string | null
): Promise<ImapPlatform> {
  const platforms = await listActiveImapPlatforms(container)
  if (platformId) {
    const p = platforms.find((x) => x.id === platformId)
    if (!p) throw new MedusaError(MedusaError.Types.NOT_FOUND, `No active IMAP platform ${platformId}`)
    return p
  }
  if (platforms.length === 1) return platforms[0]
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    platforms.length
      ? "More than one IMAP account is connected; say which with platform_id."
      : "No IMAP email account is connected. Add one under External Platforms → Email."
  )
}

/**
 * The account's folders with whether the Inbox reads each. Containers that
 * hold no mail are left out. A folder the Inbox is set to read that no longer
 * exists on the account (renamed in iCloud) is kept in the list, flagged
 * missing, so it can be unticked rather than silently failing every sync.
 */
export function mergeMailboxes(
  onAccount: ImapMailboxInfo[],
  reading: string[]
): (MailboxRow & { missing?: boolean })[] {
  const readingSet = new Set(reading)
  const rows: (MailboxRow & { missing?: boolean })[] = onAccount
    .filter((m) => m.selectable)
    .map((m) => ({ ...m, reading: readingSet.has(m.path) }))
  const present = new Set(rows.map((r) => r.path))
  for (const path of reading) {
    if (!present.has(path)) {
      rows.push({ path, name: path, special_use: null, selectable: true, reading: true, missing: true })
    }
  }
  // Inbox first, then our own folders A→Z, then the system ones (Sent, Trash…).
  const rank = (r: MailboxRow) => (r.special_use === "\\Inbox" ? 0 : r.special_use ? 2 : 1)
  return rows.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
}

async function withConnection<T>(
  platform: ImapPlatform,
  fn: (service: ImapSyncService) => Promise<T>
): Promise<T> {
  const service = createImapSyncService(platform.api_config)
  try {
    await service.connect()
  } catch (err: any) {
    await service.disconnect().catch(() => {})
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Could not reach the mailbox: ${err.message}`)
  }
  try {
    return await fn(service)
  } finally {
    await service.disconnect().catch(() => {})
  }
}

export async function listPlatformMailboxes(container: MedusaContainer, platformId?: string | null) {
  const platform = await resolveImapPlatform(container, platformId)
  const onAccount = await withConnection(platform, (s) => s.listMailboxes())
  return {
    platform: { id: platform.id, name: platform.name },
    mailboxes: mergeMailboxes(onAccount, platformMailboxes(platform.api_config)),
  }
}

/** Save which folders the Inbox reads. Keeps every other api_config key
 *  (host, user, password) as it is. */
export async function setPlatformMailboxes(
  container: MedusaContainer,
  platformId: string | null | undefined,
  mailboxes: string[]
) {
  const names = [...new Set(mailboxes.map((m) => m.trim()).filter(Boolean))]
  if (!names.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Pick at least one folder to read.")
  }
  const platform = await resolveImapPlatform(container, platformId)
  const socials = container.resolve(SOCIALS_MODULE) as any
  await socials.updateSocialPlatforms({
    selector: { id: platform.id },
    data: { api_config: { ...platform.api_config, mailboxes: names } },
  })
  return { platform: { id: platform.id, name: platform.name }, mailboxes: names }
}

/** Create a folder on the account and, unless told not to, start reading it. */
export async function createPlatformMailbox(
  container: MedusaContainer,
  platformId: string | null | undefined,
  name: string,
  read = true
) {
  const path = name.trim()
  if (!path) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Folder name is required.")
  const platform = await resolveImapPlatform(container, platformId)
  const created = await withConnection(platform, (s) => s.createMailbox(path))
  if (read) {
    await setPlatformMailboxes(container, platform.id, [...platformMailboxes(platform.api_config), created])
  }
  return { platform: { id: platform.id, name: platform.name }, path: created, reading: read }
}
