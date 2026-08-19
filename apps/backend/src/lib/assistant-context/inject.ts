/**
 * Context injection — formatting cached entries into a `## Prior context`
 * block for the system prompt.
 *
 * Called before `streamText` with the cache entries for the active domains.
 * Returns a string to append to the system prompt, or undefined if there is
 * nothing to inject. The block is advisory: it tells the model what it already
 * found so it can avoid re-fetching, but the model is free to re-call tools if
 * the user asks for fresh data.
 */

/** Maximum number of domain entries to inject — keeps the prompt thin. */
const MAX_DOMAIN_ENTRIES = 3

/** Maximum total characters of the injected block. */
const MAX_BLOCK_LEN = 1200

/**
 * How old an entry may be before it is dropped rather than injected.
 *
 * The block tells the model it already has this data, so an entry that has
 * outlived its subject does not merely waste tokens — it invites a confident
 * answer from a stale summary ("you have 5 orders, most recent order_abc").
 * Volatile domains change between conversations as a matter of course, so they
 * expire in an hour; the rest are a day. Beyond that the model should look
 * again, which is the behaviour the cache exists to make cheap, not to prevent.
 */
const VOLATILE_DOMAINS = new Set(["orders", "money", "inventory", "production"])
const VOLATILE_MAX_AGE_MS = 60 * 60 * 1000
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Max age for a domain's entry, in ms. */
export const maxAgeForDomain = (domain: string): number =>
  VOLATILE_DOMAINS.has(domain) ? VOLATILE_MAX_AGE_MS : DEFAULT_MAX_AGE_MS

/** True when a row is still worth injecting. Unparseable dates are dropped. */
export function isFresh(row: ContextCacheRow, now = Date.now()): boolean {
  const ts = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)
  const age = now - ts.getTime()
  if (Number.isNaN(age)) return false
  return age >= 0 && age <= maxAgeForDomain(row.domain)
}

export interface ContextCacheRow {
  domain: string
  entity_ids: string[] | unknown
  summary: string
  updated_at: string | Date
}

/**
 * Format cache rows as a `## Prior context` block, or return undefined if
 * there is nothing worth injecting.
 *
 * The block is structured as one short section per domain, with the entity
 * ids listed (trimmed) and the summary. A relative-time hint ("2 hours ago")
 * helps the model decide whether the data is likely still current.
 */
export function formatPriorContext(rows: ContextCacheRow[]): string | undefined {
  if (!rows?.length) return undefined

  const usable = rows.filter((r) => isFresh(r))
  if (!usable.length) return undefined

  const sections: string[] = []
  for (const row of usable.slice(0, MAX_DOMAIN_ENTRIES)) {
    const ids = Array.isArray(row.entity_ids) ? row.entity_ids : []
    const idList = ids.slice(0, 8).join(", ")
    const time = formatRelativeTime(row.updated_at)

    const lines = [
      `### ${row.domain} (${time})`,
      `- ${row.summary}`,
    ]
    if (idList) {
      lines.push(`- Entity ids: ${idList}${ids.length > 8 ? `, +${ids.length - 8} more` : ""}`)
    }
    sections.push(lines.join("\n"))
  }

  const block = sections.join("\n\n")
  const header =
    "## Prior context from earlier conversations\n" +
    "A note of what you looked at recently, to save you rediscovering ids. It is a POINTER, not a source of truth: it may be out of date, so never state a count, status, total or name from it as current — call the tool when the answer has to be right.\n\n"
  const full = header + block

  return full.length > MAX_BLOCK_LEN ? full.slice(0, MAX_BLOCK_LEN) + "\n(truncated)" : full
}

/** Format a timestamp as a human-readable relative time. */
function formatRelativeTime(ts: string | Date): string {
  const date = ts instanceof Date ? ts : new Date(ts)
  const diffMs = Date.now() - date.getTime()
  if (isNaN(diffMs)) return "earlier"

  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin} min ago`

  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`

  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`

  return `${Math.floor(diffDay / 7)} week${Math.floor(diffDay / 7) > 1 ? "s" : ""} ago`
}

/**
 * Load context entries for the active domains and format them for injection.
 *
 * Returns the formatted block string, or undefined if nothing was found.
 */
export async function loadAndFormatContext(
  cacheService: any,
  principalId: string,
  surface: string,
  domains: string[]
): Promise<string | undefined> {
  if (!cacheService || !principalId || !domains?.length) return undefined

  // The read sits before streamText on the assistant's hot path. A cache miss
  // and a cache OUTAGE (missing table, DB blip) must look the same from here:
  // the turn proceeds without prior context. Only the write path was guarded
  // when this was reviewed, which left the read able to fail the whole turn.
  let rows: any[] | undefined
  try {
    rows = await cacheService.getContextForPrincipal(principalId, surface, domains)
  } catch {
    return undefined
  }
  if (!rows?.length) return undefined

  // Filter to only the domains that were actually asked for (the service may
  // return all rows for the principal if the domains filter wasn't applied
  // server-side, though it should be).
  const wanted = new Set(domains)
  const filtered = rows.filter((r: any) => wanted.has(r.domain))

  return formatPriorContext(filtered as ContextCacheRow[])
}
