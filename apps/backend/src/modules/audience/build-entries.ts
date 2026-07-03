import { classifyContact, type ClassifierOptions, type MemberType } from "./classifier"

/**
 * PURE audience-entry builder — collapse the three source lists (persons,
 * customers, leads) into ONE row per email, merging classifications. This is the
 * "merge the leads, customers and persons into one tagged list" step (#881).
 *
 * Dedup key = lowercased email. When the same email appears in multiple sources
 * (e.g. a weaver who is also a customer), the groups/tags are UNIONED and the
 * primary member_type is chosen by priority person > customer > lead (matching
 * how the send dedupes). No IO — unit-testable.
 */

export type SourceRecord = {
  member_type: MemberType
  member_id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  metadata?: Record<string, any> | null
  state?: string | null
  sub_active?: boolean
  created_at?: string | Date | null
}

export type AudienceEntryDraft = {
  email: string
  member_type: MemberType
  member_id: string
  first_name: string | null
  last_name: string | null
  source: string
  groups: string[]
  tags: string[]
  mailable: boolean
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PRIORITY: Record<MemberType, number> = { person: 3, customer: 2, lead: 1 }

export function buildAudienceEntries(
  records: SourceRecord[],
  opts: ClassifierOptions = {}
): AudienceEntryDraft[] {
  const byEmail = new Map<string, SourceRecord[]>()
  for (const r of records ?? []) {
    const email = String(r?.email ?? "").trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email)) continue
    const list = byEmail.get(email)
    if (list) list.push(r)
    else byEmail.set(email, [r])
  }

  const out: AudienceEntryDraft[] = []
  for (const [email, recs] of byEmail) {
    // Primary record = highest priority (person > customer > lead).
    const primary = recs.reduce((a, b) =>
      PRIORITY[b.member_type] > PRIORITY[a.member_type] ? b : a
    )

    const groups = new Set<string>()
    const tags = new Set<string>()
    let anyMailable = false
    let hardOff = false
    let primarySource = "unknown"

    for (const r of recs) {
      const c = classifyContact(
        {
          member_type: r.member_type,
          email,
          metadata: r.metadata,
          state: r.state,
          sub_active: r.sub_active,
          created_at: r.created_at,
        },
        opts
      )
      c.groups.forEach((g) => groups.add(g))
      c.tags.forEach((t) => tags.add(t))
      if (c.mailable) anyMailable = true
      if (r === primary) primarySource = c.source
    }

    if (tags.has("bounced") || tags.has("unsubscribed")) hardOff = true

    out.push({
      email,
      member_type: primary.member_type,
      member_id: primary.member_id,
      first_name: primary.first_name ?? null,
      last_name: primary.last_name ?? null,
      source: primarySource,
      groups: [...groups],
      tags: [...tags],
      mailable: anyMailable && !hardOff,
    })
  }

  return out
}

/** PURE: composition summary for the "who's in here" dashboard. */
export function summarizeEntries(entries: AudienceEntryDraft[]) {
  const bySource: Record<string, number> = {}
  const byTag: Record<string, number> = {}
  const byMemberType: Record<string, number> = {}
  let mailable = 0
  for (const e of entries) {
    bySource[e.source] = (bySource[e.source] ?? 0) + 1
    byMemberType[e.member_type] = (byMemberType[e.member_type] ?? 0) + 1
    for (const t of e.tags) byTag[t] = (byTag[t] ?? 0) + 1
    if (e.mailable) mailable++
  }
  return { total: entries.length, mailable, bySource, byTag, byMemberType }
}
