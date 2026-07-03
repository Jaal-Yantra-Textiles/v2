import { Modules } from "@medusajs/framework/utils"

import { PERSON_MODULE } from "../person"
import { SOCIALS_MODULE } from "../socials"
import { EMAIL_SUPPRESSION_MODULE } from "./index"

/**
 * Shared suppression core — the ONE place an email gets taken out of the
 * newsletter/blog audience, called from:
 *   - the provider bounce/complaint webhooks (Mailjet + Resend), and
 *   - the manual CSV Data-Plumbing job.
 *
 * It flips person/customer/lead records (the three sources the send unions) and
 * writes an `email_suppression` audit row. Idempotent on `event_id` so a
 * re-delivered webhook is a no-op.
 */

export type SuppressReason =
  | "hard_bounce"
  | "soft_bounce"
  | "spam_complaint"
  | "unsubscribe"
  | "manual"

export type SuppressProvider = "mailjet" | "resend" | "manual" | "other"

export type SuppressInput = {
  email: string
  reason: SuppressReason
  provider: SuppressProvider
  /** Provider event id for idempotency (optional). */
  event_id?: string | null
  /** When the provider recorded the event (ISO). */
  event_at?: string | null
  /** Raw provider payload snippet for audit. */
  raw?: any
}

export type SuppressOutcome = {
  email: string
  reason: SuppressReason
  /** true when we flipped at least one record off. */
  suppressed: boolean
  persons: number
  customers: number
  leads: number
  matched: number
  /** true when skipped because the same event_id was already processed. */
  duplicate: boolean
  /** true when this reason only logs and doesn't flip records (soft bounce). */
  logged_only: boolean
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** PURE: normalize + validate an email; "" if invalid. */
export function normalizeEmail(raw: unknown): string {
  const e = String(raw ?? "").trim().toLowerCase()
  return EMAIL_RE.test(e) ? e : ""
}

/**
 * PURE: which reasons actually remove someone from the list. Soft bounces are
 * transient (mailbox full, greylisting) so we LOG them but keep the recipient —
 * only hard bounces, spam complaints, explicit unsubscribes and manual entries
 * suppress. This is the deliverability policy in one place.
 */
export function reasonSuppresses(reason: SuppressReason): boolean {
  return reason !== "soft_bounce"
}

/**
 * PURE: the metadata fields to stamp for a suppression reason, merged over
 * existing metadata (Medusa replaces the whole blob on update). Returns null
 * when the record already carries the flag (idempotent no-op).
 *
 *  - hard_bounce / soft_bounce  → metadata.bounced
 *  - spam_complaint             → metadata.bounced + metadata.complained
 *  - unsubscribe                → metadata.unsubscribed
 *  - manual                     → metadata.bounced (treated as a hard suppression)
 */
export function suppressionMetadata(
  existing: Record<string, any> | null | undefined,
  reason: SuppressReason,
  at: string
): Record<string, any> | null {
  const m = existing || {}
  if (reason === "unsubscribe") {
    if (m.unsubscribed === true) return null
    return { ...m, unsubscribed: true, unsubscribed_at: at }
  }
  if (reason === "spam_complaint") {
    if (m.bounced === true && m.complained === true) return null
    return {
      ...m,
      bounced: true,
      bounced_at: m.bounced_at || at,
      complained: true,
      complained_at: at,
      bounce_reason: "spam_complaint",
    }
  }
  // hard_bounce | soft_bounce | manual → bounced
  if (m.bounced === true) return null
  return {
    ...m,
    bounced: true,
    bounced_at: at,
    bounce_reason: reason,
  }
}

/**
 * Suppress a single email across all three sources + write the audit row.
 * Container-driven (resolves person / customer / socials / email_suppression).
 */
export async function suppressEmail(
  container: any,
  input: SuppressInput
): Promise<SuppressOutcome> {
  const email = normalizeEmail(input.email)
  const reason = input.reason
  const at = input.event_at || new Date().toISOString()

  const personService: any = container.resolve(PERSON_MODULE)
  const customerService: any = container.resolve(Modules.CUSTOMER)
  const socialsService: any = container.resolve(SOCIALS_MODULE)
  const suppressionService: any = container.resolve(EMAIL_SUPPRESSION_MODULE)

  const base: SuppressOutcome = {
    email,
    reason,
    suppressed: false,
    persons: 0,
    customers: 0,
    leads: 0,
    matched: 0,
    duplicate: false,
    logged_only: false,
  }

  if (!email) return base

  // Idempotency: same provider event already processed → no-op.
  if (input.event_id) {
    const existing = await suppressionService
      .listEmailSuppressions({ event_id: input.event_id }, { take: 1 })
      .catch(() => [])
    if (existing?.length) return { ...base, duplicate: true }
  }

  const flip = reasonSuppresses(reason)

  if (flip) {
    // Persons — subscription inactive + metadata flag.
    const people: any[] = await personService
      .listPeople({ email }, { relations: ["subscribed"] })
      .catch(() => [])
    for (const p of people) {
      base.matched++
      const sub = p.subscribed
      const subNeedsOff =
        sub && sub.subscription_status !== "inactive" && reason !== "soft_bounce"
      const nextMeta = suppressionMetadata(p.metadata, reason, at)
      if (!subNeedsOff && !nextMeta) continue
      if (subNeedsOff) {
        await personService.updatePersonSubs({
          id: sub.id,
          subscription_status: "inactive",
          email_subscribed: "false",
        })
      }
      if (nextMeta) await personService.updatePeople({ id: p.id, metadata: nextMeta })
      base.persons++
    }

    // Customers — metadata flag.
    const custs: any[] = await customerService
      .listCustomers({ email }, { select: ["id", "email", "metadata"] })
      .catch(() => [])
    for (const c of custs) {
      base.matched++
      const nextMeta = suppressionMetadata(c.metadata, reason, at)
      if (!nextMeta) continue
      await customerService.updateCustomers(c.id, { metadata: nextMeta })
      base.customers++
    }

    // Leads — metadata flag.
    const lds: any[] = await socialsService
      .listLeads({ email }, { select: ["id", "email", "metadata"] })
      .catch(() => [])
    for (const l of lds) {
      base.matched++
      const nextMeta = suppressionMetadata(l.metadata, reason, at)
      if (!nextMeta) continue
      await socialsService.updateLeads({ id: l.id, metadata: nextMeta })
      base.leads++
    }
  }

  base.suppressed = base.persons + base.customers + base.leads > 0
  base.logged_only = !flip

  // Durable audit row (best-effort — a logging failure never fails the caller).
  try {
    await suppressionService.createEmailSuppressions({
      email,
      reason,
      provider: input.provider,
      event_id: input.event_id ?? null,
      event_at: at,
      suppressed: base.suppressed,
      persons: base.persons,
      customers: base.customers,
      leads: base.leads,
      raw: input.raw ?? null,
    })
  } catch {
    // swallow — the suppression already happened
  }

  return base
}
