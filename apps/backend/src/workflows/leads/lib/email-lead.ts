// Pure, side-effect-free helpers for the email-driven lead pipeline (#460, slice 1).
//
// Kept free of Medusa/container deps so the "is this email a lead?", the
// idempotent Lead-create input assembly, and the follow-up selection logic are
// all unit-testable without booting Medusa, a DB, or a mail provider.
//
// Pairs with two scheduled jobs:
//   - `ingest-lead-emails.ts`        — scans inbound emails landing in a "leads"
//     folder and upserts a `Lead` (socials module), idempotent on `meta_lead_id`.
//   - `send-lead-followup-reminders.ts` — nudges email-source leads with no
//     activity after N days by emitting `lead.followup_due` (idempotent stamp).
//
// Mirrors the feedback-reminder pattern (pure selector + scheduled job +
// idempotent metadata stamp + fail-soft) in `workflows/feedback/lib`.

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Lead.source_platform value used for email-captured leads. */
export const EMAIL_LEAD_SOURCE = "email"

/** Default IMAP folders / categories that mark an email as a sales lead. */
export const DEFAULT_LEAD_FOLDERS = ["Leads", "leads"]

/** Event emitted when an email-source lead has gone stale and needs follow-up. */
export const LEAD_FOLLOWUP_DUE_EVENT = "lead.followup_due"

export interface InboundEmailRow {
  id?: string | null
  imap_uid?: string | null
  message_id?: string | null
  from_address?: string | null
  subject?: string | null
  text_body?: string | null
  html_body?: string | null
  folder?: string | null
  status?: string | null
  received_at?: Date | string | null
  metadata?: Record<string, any> | null
}

/**
 * Normalise the configured "leads" folder list. Accepts a comma-separated env
 * string or an array; falls back to {@link DEFAULT_LEAD_FOLDERS}. Comparison is
 * always case-insensitive (see {@link isLeadEmail}).
 */
export function resolveLeadFolders(
  configured?: string | string[] | null
): string[] {
  if (Array.isArray(configured)) {
    const cleaned = configured.map((f) => String(f).trim()).filter(Boolean)
    return cleaned.length > 0 ? cleaned : [...DEFAULT_LEAD_FOLDERS]
  }
  if (typeof configured === "string" && configured.trim()) {
    const cleaned = configured
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean)
    if (cleaned.length > 0) {
      return cleaned
    }
  }
  return [...DEFAULT_LEAD_FOLDERS]
}

/**
 * Parse a raw `From` header ("Jane Doe <jane@x.com>" or "jane@x.com") into a
 * display name + lowercased email address. Either part may be empty.
 */
export function parseFromAddress(from?: string | null): {
  email: string
  fullName: string
} {
  const raw = (from || "").trim()
  if (!raw) {
    return { email: "", fullName: "" }
  }

  const angle = raw.match(/^(.*)<([^>]+)>\s*$/)
  if (angle) {
    const name = angle[1].trim().replace(/^["']|["']$/g, "")
    const email = angle[2].trim().toLowerCase()
    return { email, fullName: name }
  }

  // Bare address — no display name.
  if (raw.includes("@")) {
    return { email: raw.toLowerCase(), fullName: "" }
  }
  return { email: "", fullName: raw }
}

/** Split a display name into best-effort first / last parts. */
export function splitName(fullName?: string | null): {
  first_name: string | null
  last_name: string | null
} {
  const name = (fullName || "").trim()
  if (!name) {
    return { first_name: null, last_name: null }
  }
  const parts = name.split(/\s+/)
  if (parts.length === 1) {
    return { first_name: parts[0], last_name: null }
  }
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  }
}

/**
 * Stable idempotency key for an email-sourced lead. Prefers the RFC message-id
 * (unique per message), then the IMAP uid + folder, then a from+subject
 * composite. Stored as `Lead.meta_lead_id` so a re-scan never double-creates.
 */
export function buildEmailLeadKey(email: InboundEmailRow): string {
  const mid = (email.message_id || "").trim()
  if (mid) {
    return `email:${mid}`
  }
  const uid = (email.imap_uid || "").trim()
  if (uid) {
    return `email:${(email.folder || "INBOX").trim()}:${uid}`
  }
  const from = (email.from_address || "unknown").trim().toLowerCase()
  const subj = (email.subject || "").trim().toLowerCase()
  return `email:${from}:${subj}`
}

/**
 * Does this inbound email count as a lead? It must live in a configured "leads"
 * folder (case-insensitive) and not already be ignored.
 */
export function isLeadEmail(
  email: InboundEmailRow,
  folders: string[] = DEFAULT_LEAD_FOLDERS
): boolean {
  if (!email || email.status === "ignored") {
    return false
  }
  const folder = (email.folder || "").trim().toLowerCase()
  if (!folder) {
    return false
  }
  return folders.some((f) => f.trim().toLowerCase() === folder)
}

/** Short plain-text snippet for the lead note / metadata (no HTML). */
export function buildEmailSnippet(
  email: InboundEmailRow,
  maxLen = 280
): string {
  const body = (email.text_body || "").replace(/\s+/g, " ").trim()
  if (!body) {
    return ""
  }
  return body.length > maxLen ? `${body.slice(0, maxLen - 1)}…` : body
}

export interface EmailLeadInput {
  meta_lead_id: string
  email: string | null
  full_name: string | null
  first_name: string | null
  last_name: string | null
  source_platform: string
  status: "new"
  created_time: Date
  notes: string | null
  field_data: Array<{ name: string; values: string[] }>
  metadata: Record<string, any>
}

/**
 * Assemble the `socials.createLeads` input for an inbound lead email. The
 * `created_time` mirrors when the email was received; `status` starts at `new`;
 * `metadata.source` records provenance + a back-link to the inbound email row.
 */
export function buildLeadInputFromEmail(
  email: InboundEmailRow,
  now: Date = new Date()
): EmailLeadInput {
  const { email: addr, fullName } = parseFromAddress(email.from_address)
  const { first_name, last_name } = splitName(fullName)
  const received = email.received_at ? new Date(email.received_at) : now
  const createdTime = Number.isNaN(received.getTime()) ? now : received
  const snippet = buildEmailSnippet(email)
  const subject = (email.subject || "").trim() || "(no subject)"

  return {
    meta_lead_id: buildEmailLeadKey(email),
    email: addr || null,
    full_name: fullName || null,
    first_name,
    last_name,
    source_platform: EMAIL_LEAD_SOURCE,
    status: "new",
    created_time: createdTime,
    notes: snippet || subject,
    field_data: [
      { name: "subject", values: [subject] },
      ...(snippet ? [{ name: "snippet", values: [snippet] }] : []),
    ],
    metadata: {
      source: "inbound_email",
      inbound_email_id: email.id || null,
      message_id: email.message_id || null,
      folder: email.folder || null,
      subject,
    },
  }
}

export interface SelectLeadEmailsOptions {
  folders?: string[]
  /** Set of `meta_lead_id` keys already present, to skip re-ingest. */
  existingKeys?: Set<string> | string[]
  maxBatch?: number
}

/**
 * From a batch of inbound emails, select the ones in a leads folder that have
 * not yet been turned into a Lead (key not in `existingKeys`). De-duplicates by
 * key within the batch and caps at `maxBatch`.
 */
export function selectLeadEmailsToIngest(
  emails: InboundEmailRow[] | null | undefined,
  options: SelectLeadEmailsOptions = {}
): InboundEmailRow[] {
  if (!Array.isArray(emails) || emails.length === 0) {
    return []
  }
  const folders = options.folders ?? DEFAULT_LEAD_FOLDERS
  const existing =
    options.existingKeys instanceof Set
      ? options.existingKeys
      : new Set(options.existingKeys || [])
  const maxBatch = options.maxBatch ?? 200

  const seen = new Set<string>()
  const out: InboundEmailRow[] = []
  for (const email of emails) {
    if (!isLeadEmail(email, folders)) {
      continue
    }
    const key = buildEmailLeadKey(email)
    if (existing.has(key) || seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(email)
    if (out.length >= maxBatch) {
      break
    }
  }
  return out
}

// ============ FOLLOW-UP SELECTION ============

export interface LeadRow {
  id: string
  email?: string | null
  full_name?: string | null
  status?: string | null
  source_platform?: string | null
  created_time?: Date | string | null
  contacted_at?: Date | string | null
  deleted_at?: Date | string | null
  metadata?: Record<string, any> | null
}

export interface SelectLeadFollowupsOptions {
  now?: Date
  minAgeDays?: number
  maxBatch?: number
}

/**
 * Idempotency guard: a lead is stamped with `metadata.followup_nudged_at` after
 * a successful nudge, so its presence means "already nudged this cycle".
 */
export function leadFollowupAlreadyNudged(lead: LeadRow): boolean {
  return !!lead?.metadata?.followup_nudged_at
}

/**
 * The reference moment a lead's "no response" clock starts from: the last
 * contact if any, else when the lead was created.
 */
function leadActivityAt(lead: LeadRow): number {
  const ref = lead.contacted_at || lead.created_time
  const t = ref ? new Date(ref).getTime() : NaN
  return t
}

/**
 * Select email-source leads that need a follow-up nudge: still open
 * (`new` / `contacted`), originated from email, older than `minAgeDays` with no
 * activity, not soft-deleted, and not already nudged. Oldest first, capped.
 */
export function selectLeadsNeedingFollowup(
  leads: LeadRow[] | null | undefined,
  options: SelectLeadFollowupsOptions = {}
): LeadRow[] {
  if (!Array.isArray(leads) || leads.length === 0) {
    return []
  }
  const now = options.now ?? new Date()
  const minAgeDays = options.minAgeDays ?? 3
  const maxBatch = options.maxBatch ?? 100
  const cutoff = now.getTime() - minAgeDays * MS_PER_DAY

  return leads
    .filter((l) => {
      if (!l || !l.id || l.deleted_at) {
        return false
      }
      if (l.source_platform !== EMAIL_LEAD_SOURCE) {
        return false
      }
      const status = l.status ?? "new"
      if (status !== "new" && status !== "contacted") {
        return false
      }
      if (leadFollowupAlreadyNudged(l)) {
        return false
      }
      const at = leadActivityAt(l)
      if (Number.isNaN(at)) {
        return false
      }
      return at <= cutoff
    })
    .sort((a, b) => leadActivityAt(a) - leadActivityAt(b))
    .slice(0, Math.max(0, maxBatch))
}
