/**
 * PURE lead -> CRM mapping. No container, no IO — so the whole "which of these
 * 230 leads can become a contact, and what does it look like" question is
 * unit-testable without booting Medusa or reaching the CRM node.
 *
 * ## Why this exists
 *
 * `socials.Lead` (Postgres) is already the merged ad-intake table: the Meta
 * leadgen webhook, the Facebook webhook, the manual `/admin/meta-ads/leads/sync`
 * pull and the email-ingest job all write to it. What it has never had is a way
 * OUT — into the CRM where somebody actually works the contact. `Lead` has
 * carried `external_id` / `external_system` / `synced_to_external_at` since it
 * was written, unused. Those three fields are the link, and the idempotency key.
 *
 * ## The shape of the real data (checked against prod, not assumed)
 *
 * All 230 production leads have `full_name` and NEITHER `first_name` NOR
 * `last_name`. Many are a single token with no surname at all
 * ("SukhdevDhiman"). `crm_person.last_name` is therefore modelled nullable —
 * see the note on the contract. A mapper that assumed the split fields were
 * populated would have produced 230 contacts named "" "".
 *
 * Note the contract's `required` check only rejects `undefined`, so an empty
 * string would have passed validation silently. Absent data is represented as
 * `null` here, deliberately, so a missing surname stays visibly missing.
 */
import {
  isUsableEmail,
  splitFullName,
} from "../../workflows/ad-planning/conversions/person-identity-lib"

/** The `Lead` fields this mapping reads. Structural, so tests need no ORM row. */
export type LeadSource = {
  id: string
  email?: string | null
  phone?: string | null
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  job_title?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  source_platform?: string | null
  campaign_name?: string | null
  campaign_id?: string | null
  ad_name?: string | null
  form_name?: string | null
  created_time?: string | Date | null
  status?: string | null
  external_id?: string | null
  external_system?: string | null
  metadata?: Record<string, any> | null
}

/** A `crm_person` create payload. Mirrors crmPersonContract. */
export type CrmPersonDraft = {
  first_name: string
  last_name: string | null
  email: string
  phone: string | null
  title: string | null
  metadata: Record<string, any>
}

/** `external_system` value stamped back onto an imported Lead. */
export const CRM_EXTERNAL_SYSTEM = "crm"

/**
 * Canonical source names. Prod carries THREE spellings for two platforms —
 * `fb` (113), `ig` (116) and `facebook` (1) — because the leadgen webhook, the
 * Facebook webhook and the sync route each stamp their own. Grouping "leads by
 * source" is wrong until they agree, so collapse on read rather than migrating
 * rows that other screens still display.
 */
const SOURCE_ALIASES: Record<string, string> = {
  fb: "facebook",
  facebook: "facebook",
  ig: "instagram",
  instagram: "instagram",
  email: "email",
  extension: "extension",
}

export function normalizeLeadSource(raw?: string | null): string {
  const key = (raw ?? "").trim().toLowerCase()
  if (!key) return "unknown"
  return SOURCE_ALIASES[key] ?? key
}

/**
 * Best-effort {first,last} for a lead. Precedence: the split fields when the
 * source actually populated them, then `full_name`, then the email local-part
 * (reusing the same derivation the order->Person backfill uses, so a contact
 * imported from a lead and one derived from an order read alike).
 *
 * Returns `last_name: null` — not `""` — when there is no surname.
 */
export function deriveLeadName(lead: LeadSource): {
  first_name: string
  last_name: string | null
} {
  const first = (lead.first_name ?? "").trim()
  const last = (lead.last_name ?? "").trim()
  if (first || last) {
    return { first_name: first, last_name: last || null }
  }

  const full = (lead.full_name ?? "").trim()
  if (full) {
    const split = splitFullName(full)
    return { first_name: split.first_name, last_name: split.last_name || null }
  }

  const email = (lead.email ?? "").trim()
  if (isUsableEmail(email)) {
    const local = email.split("@")[0].replace(/[._+-]+/g, " ")
    const split = splitFullName(local)
    return {
      first_name: titleCase(split.first_name),
      last_name: titleCase(split.last_name) || null,
    }
  }

  return { first_name: "", last_name: null }
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/**
 * Build the `crm_person` payload for a lead, or `null` when the lead cannot
 * become a contact.
 *
 * A usable email is REQUIRED, and not merely for politeness: `crm_person`
 * declares `unique: ["email"]`, so it is the only key by which a re-run can
 * recognise a contact it already created. Importing an email-less lead would
 * create a row that every subsequent run duplicates.
 */
export function buildCrmPersonDraft(lead: LeadSource): CrmPersonDraft | null {
  const email = (lead.email ?? "").trim().toLowerCase()
  if (!isUsableEmail(email)) return null

  const { first_name, last_name } = deriveLeadName(lead)
  if (!first_name) return null

  return {
    first_name,
    last_name,
    email,
    phone: (lead.phone ?? "").trim() || null,
    title: (lead.job_title ?? "").trim() || null,
    // Provenance travels with the contact. Without it a CRM person is an
    // orphan: you cannot tell which campaign bought them or go back to the
    // original form submission.
    metadata: {
      lead_id: lead.id,
      source: normalizeLeadSource(lead.source_platform),
      source_raw: lead.source_platform ?? null,
      campaign_name: lead.campaign_name ?? null,
      campaign_id: lead.campaign_id ?? null,
      ad_name: lead.ad_name ?? null,
      form_name: lead.form_name ?? null,
      captured_at: toIso(lead.created_time),
      city: (lead.city ?? "").trim() || null,
      state: (lead.state ?? "").trim() || null,
      country: (lead.country ?? "").trim() || null,
    },
  }
}

function toIso(v?: string | Date | null): string | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// ---------------------------------------------------------------------------

export type LeadImportAction =
  /** Create a new crm_person, then stamp the lead. */
  | { kind: "create"; lead: LeadSource; draft: CrmPersonDraft }
  /** A crm_person already holds this email — stamp the lead at it, create nothing. */
  | { kind: "link"; lead: LeadSource; crm_person_id: string }
  /** Nothing to do. */
  | { kind: "skip"; lead: LeadSource; reason: LeadSkipReason }

export type LeadSkipReason =
  | "already_imported"
  | "no_usable_email"
  | "no_usable_name"
  | "duplicate_in_batch"

export type LeadImportPlan = {
  actions: LeadImportAction[]
  counts: Record<string, number>
}

/**
 * Decide what to do with every lead, given the contacts the CRM already holds.
 *
 * Idempotent on TWO independent keys, because either alone leaks:
 *  - the lead's own `external_id`/`external_system` stamp (a lead imported
 *    before is never re-imported), and
 *  - the crm_person email index (a contact that arrived by another route — the
 *    browser extension, a manual create — is linked, not duplicated).
 *
 * `existingPersonIdByEmail` keys are matched case-insensitively; callers pass
 * whatever the CRM returned and this lowercases both sides.
 *
 * Within a single batch the first lead for an email wins and later ones are
 * `duplicate_in_batch`, so one run cannot race itself into a uniqueness error
 * that the contract would reject anyway.
 */
export function planLeadImport(
  leads: LeadSource[],
  existingPersonIdByEmail: Record<string, string> = {}
): LeadImportPlan {
  const existing = new Map<string, string>()
  for (const [email, id] of Object.entries(existingPersonIdByEmail)) {
    if (email) existing.set(email.trim().toLowerCase(), id)
  }

  const seenInBatch = new Set<string>()
  const actions: LeadImportAction[] = []

  for (const lead of leads) {
    if (lead.external_system === CRM_EXTERNAL_SYSTEM && lead.external_id) {
      actions.push({ kind: "skip", lead, reason: "already_imported" })
      continue
    }

    const draft = buildCrmPersonDraft(lead)
    if (!draft) {
      const reason: LeadSkipReason = isUsableEmail((lead.email ?? "").trim())
        ? "no_usable_name"
        : "no_usable_email"
      actions.push({ kind: "skip", lead, reason })
      continue
    }

    const hit = existing.get(draft.email)
    if (hit) {
      actions.push({ kind: "link", lead, crm_person_id: hit })
      continue
    }

    if (seenInBatch.has(draft.email)) {
      actions.push({ kind: "skip", lead, reason: "duplicate_in_batch" })
      continue
    }

    seenInBatch.add(draft.email)
    actions.push({ kind: "create", lead, draft })
  }

  const counts: Record<string, number> = {}
  for (const a of actions) {
    const key = a.kind === "skip" ? `skip_${a.reason}` : a.kind
    counts[key] = (counts[key] ?? 0) + 1
  }

  return { actions, counts }
}

/** One-line human summary of a plan, for the maintenance-job result. */
export function summarizeLeadImport(plan: LeadImportPlan, dryRun: boolean): string {
  const c = plan.counts
  const verb = dryRun ? "Would import" : "Imported"
  const parts = [
    `${verb} ${c.create ?? 0} lead(s) as CRM contacts`,
    `${c.link ?? 0} linked to existing contacts`,
    `${c.skip_already_imported ?? 0} already imported`,
  ]
  const unusable = (c.skip_no_usable_email ?? 0) + (c.skip_no_usable_name ?? 0)
  if (unusable) parts.push(`${unusable} unusable (no email/name)`)
  if (c.skip_duplicate_in_batch) {
    parts.push(`${c.skip_duplicate_in_batch} duplicate email(s) within the batch`)
  }
  return `${parts.join(", ")}.`
}
