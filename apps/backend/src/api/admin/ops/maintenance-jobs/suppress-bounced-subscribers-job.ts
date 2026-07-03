import { MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PERSON_MODULE } from "../../../../modules/person"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #457 Data Plumbing — suppress hard-bounced email addresses.
 *
 * Given a list of hard-bounced emails (from an ESP export), take each matching
 * recipient OUT of the mailing audience and record why:
 *   - person    → set its subscription inactive + stamp `metadata.bounced`
 *   - customer  → stamp `metadata.bounced` (the send path skips bounced)
 *   - lead      → stamp `metadata.bounced` (the send path skips bounced)
 *
 * These are the three sources the blog/newsletter send unions
 * (`workflows/blogs/send-blog-subscribers/steps/get-subscribers.ts`), so an email
 * that hard-bounces as a customer OR a lead is suppressed too — not just persons.
 *
 * Idempotent: an address already inactive + already flagged bounced is a no-op.
 * Dry-run previews exactly what it would suppress without persisting.
 *
 * Protects sender reputation: continuing to mail hard-bounces tanks deliverability.
 */

/** Hard cap on emails accepted per call. */
export const MAX_BOUNCE_EMAILS = 5000

const paramsSchema = z.object({
  /** Bounced emails — any delimiter (comma / newline / space / semicolon). */
  emails: z.string().min(1, "emails is required"),
  /** Recorded on metadata.bounce_reason (default "hard_bounce"). */
  reason: z.string().optional().default("hard_bounce"),
  /** Recorded on metadata.bounce_source (default "csv_import"). */
  source: z.string().optional().default("csv_import"),
})

/**
 * PURE: split a free-form emails blob into a normalized, de-duplicated,
 * lowercased list of valid addresses. Accepts any of comma / newline / space /
 * semicolon / tab as separators.
 */
export function parseEmails(raw: string): string[] {
  const isEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)
  const seen = new Set<string>()
  for (const tok of String(raw).split(/[\s,;]+/)) {
    const e = tok.trim().toLowerCase()
    if (e && isEmail(e) && !seen.has(e)) seen.add(e)
  }
  return [...seen]
}

/**
 * PURE: decide the metadata to persist for a bounced record, preserving any
 * existing metadata (Medusa replaces the whole blob on update, so we must merge).
 * Returns null when the record is already flagged bounced (idempotent no-op).
 */
export function bounceMetadata(
  existing: Record<string, any> | null | undefined,
  opts: { reason: string; source: string; at: string }
): Record<string, any> | null {
  if (existing && (existing as any).bounced === true) return null
  return {
    ...(existing || {}),
    bounced: true,
    bounced_at: opts.at,
    bounce_reason: opts.reason,
    bounce_source: opts.source,
  }
}

export const suppressBouncedSubscribersJob: MaintenanceJob = {
  id: "suppress-bounced-subscribers",
  label: "Suppress hard-bounced subscribers",
  description:
    `Take hard-bounced email addresses out of the newsletter/blog audience. For each email it matches a person (→ subscription set inactive + metadata.bounced), a customer (→ metadata.bounced), and a lead (→ metadata.bounced) — the three sources the send unions — so bounces are suppressed across all of them. Paste the bounced addresses into 'emails' (any delimiter; max ${MAX_BOUNCE_EMAILS}). Idempotent (already-suppressed = no-op). Dry-run previews the matches + changes without persisting; apply writes them. Guards deliverability — mailing hard-bounces wrecks sender reputation.`,
  params: [
    {
      name: "emails",
      type: "string",
      required: true,
      description: "Bounced email addresses, any delimiter (comma/newline/space)",
    },
    {
      name: "reason",
      type: "string",
      required: false,
      description: 'Bounce reason recorded on metadata (default "hard_bounce")',
    },
    {
      name: "source",
      type: "string",
      required: false,
      description: 'Where the list came from, recorded on metadata (default "csv_import")',
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const emails = parseEmails(parsed.data.emails)
    if (!emails.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "No valid emails supplied")
    }
    if (emails.length > MAX_BOUNCE_EMAILS) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Too many emails (${emails.length} > ${MAX_BOUNCE_EMAILS})`
      )
    }
    const at = new Date().toISOString()
    const meta = { reason: parsed.data.reason, source: parsed.data.source, at }

    const personService: any = container.resolve(PERSON_MODULE)
    const customerService: any = container.resolve(Modules.CUSTOMER)
    const socialsService: any = container.resolve(SOCIALS_MODULE)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    const matched = new Set<string>()
    let personsSuppressed = 0
    let customersSuppressed = 0
    let leadsSuppressed = 0

    // --- Persons (subscription inactive + metadata.bounced) ---
    const persons: any[] = await personService
      .listPeople({ email: emails }, { relations: ["subscribed"] })
      .catch(() => [])
    for (const p of persons) {
      try {
        matched.add(String(p.email || "").toLowerCase())
        const sub = p.subscribed
        const subNeedsOff = sub && sub.subscription_status !== "inactive"
        const nextMeta = bounceMetadata(p.metadata, meta)
        if (!subNeedsOff && !nextMeta) continue // already suppressed
        changes.push({
          entity: "person",
          id: p.id,
          field: "bounced",
          before: { subscription: sub?.subscription_status ?? null, bounced: !!p.metadata?.bounced },
          after: { subscription: sub ? "inactive" : null, bounced: true },
        })
        if (!dry_run) {
          if (subNeedsOff) {
            await personService.updatePersonSubs({
              id: sub.id,
              subscription_status: "inactive",
              email_subscribed: "false",
            })
          }
          if (nextMeta) await personService.updatePeople({ id: p.id, metadata: nextMeta })
        }
        personsSuppressed++
      } catch (e: any) {
        errors.push({ id: p.id, message: e?.message ?? String(e) })
      }
    }

    // --- Customers (metadata.bounced) ---
    const customers: any[] = await customerService
      .listCustomers({ email: emails }, { select: ["id", "email", "metadata"] })
      .catch(() => [])
    for (const c of customers) {
      try {
        matched.add(String(c.email || "").toLowerCase())
        const nextMeta = bounceMetadata(c.metadata, meta)
        if (!nextMeta) continue
        changes.push({ entity: "customer", id: c.id, field: "metadata.bounced", before: false, after: true })
        if (!dry_run) await customerService.updateCustomers(c.id, { metadata: nextMeta })
        customersSuppressed++
      } catch (e: any) {
        errors.push({ id: c.id, message: e?.message ?? String(e) })
      }
    }

    // --- Leads (metadata.bounced; sales status left untouched) ---
    const leads: any[] = await socialsService
      .listLeads({ email: emails }, { select: ["id", "email", "metadata"] })
      .catch(() => [])
    for (const l of leads) {
      try {
        matched.add(String(l.email || "").toLowerCase())
        const nextMeta = bounceMetadata(l.metadata, meta)
        if (!nextMeta) continue
        changes.push({ entity: "lead", id: l.id, field: "metadata.bounced", before: false, after: true })
        if (!dry_run) await socialsService.updateLeads({ id: l.id, metadata: nextMeta })
        leadsSuppressed++
      } catch (e: any) {
        errors.push({ id: l.id, message: e?.message ?? String(e) })
      }
    }

    const notFound = emails.filter((e) => !matched.has(e))
    const verb = dry_run ? "Would suppress" : "Suppressed"
    const summary =
      `${verb} ${matched.size}/${emails.length} bounced address(es): ` +
      `${personsSuppressed} person(s), ${customersSuppressed} customer(s), ${leadsSuppressed} lead(s); ` +
      `${notFound.length} not found${errors.length ? `, ${errors.length} error(s)` : ""}.`

    return {
      job_id: suppressBouncedSubscribersJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
      errors,
    }
  },
}

export default suppressBouncedSubscribersJob
