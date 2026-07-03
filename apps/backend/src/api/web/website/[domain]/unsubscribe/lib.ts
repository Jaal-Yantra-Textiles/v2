import { Modules } from "@medusajs/framework/utils"

import { PERSON_MODULE } from "../../../../../modules/person"
import { SOCIALS_MODULE } from "../../../../../modules/socials"

/**
 * Public unsubscribe — the counterpart to the newsletter/blog send.
 *
 * The email footer links to `${FRONTEND_URL}/unsubscribe?id=<id>&email=<email>`.
 * The `id` is ambiguous — the send unions three sources
 * (`workflows/blogs/send-blog-subscribers/steps/get-subscribers.ts`) and stamps
 * `id` from whichever matched (person | customer | lead) — so we suppress by
 * EMAIL, resolving the email from the id when the link doesn't carry it.
 *
 * Suppressing an email flips every record that shares it OUT of the audience:
 *   - person   → subscription inactive + `metadata.unsubscribed`
 *   - customer → `metadata.unsubscribed`
 *   - lead     → `metadata.unsubscribed`
 * The send path skips `metadata.unsubscribed` (and inactive person subs), so the
 * address stops receiving mail across all three. Distinct from a hard bounce
 * (`metadata.bounced`) — this is a recipient-initiated opt-out.
 *
 * Idempotent: an address already unsubscribed is a no-op.
 */

export type UnsubServices = {
  personService: any
  customerService: any
  socialsService: any
}

/** Resolve the three module services from the request container. */
export function resolveUnsubServices(container: any): UnsubServices {
  return {
    personService: container.resolve(PERSON_MODULE),
    customerService: container.resolve(Modules.CUSTOMER),
    socialsService: container.resolve(SOCIALS_MODULE),
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** PURE: is this a syntactically valid, single email address? */
export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email.trim())
}

/**
 * PURE: mask an email for display on the confirmation page so we can echo which
 * address is being unsubscribed without exposing the full address to whoever
 * opened the link. e.g. `jane.doe@example.com` → `ja***@example.com`.
 */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = String(email).trim().toLowerCase().split("@")
  if (!domain) return "***"
  const head = local.slice(0, 2)
  const masked = local.length <= 2 ? `${head}***` : `${head}***`
  return `${masked}@${domain}`
}

/**
 * PURE: decide the metadata to persist when unsubscribing a record. Preserves
 * existing metadata (Medusa replaces the whole blob on update). Returns null
 * when the record is already unsubscribed (idempotent no-op).
 */
export function unsubscribeMetadata(
  existing: Record<string, any> | null | undefined,
  at: string
): Record<string, any> | null {
  if (existing && (existing as any).unsubscribed === true) return null
  return {
    ...(existing || {}),
    unsubscribed: true,
    unsubscribed_at: at,
  }
}

/**
 * Resolve an email address from an ambiguous subscriber id. The id may belong to
 * a person, a customer, or a lead — try each until one matches. Returns the
 * lower-cased email, or null if the id resolves to nothing.
 */
export async function resolveEmailById(
  services: UnsubServices,
  id: string
): Promise<string | null> {
  const { personService, customerService, socialsService } = services

  const [person] = await personService
    .listPeople({ id }, { select: ["id", "email"], take: 1 })
    .catch(() => [])
  if (person?.email && isValidEmail(person.email)) return person.email.toLowerCase()

  const [customer] = await customerService
    .listCustomers({ id }, { select: ["id", "email"], take: 1 })
    .catch(() => [])
  if (customer?.email && isValidEmail(customer.email)) return customer.email.toLowerCase()

  const [lead] = await socialsService
    .listLeads({ id }, { select: ["id", "email"], take: 1 })
    .catch(() => [])
  if (lead?.email && isValidEmail(lead.email)) return lead.email.toLowerCase()

  return null
}

export type SuppressResult = {
  email: string
  suppressed: number
  persons: number
  customers: number
  leads: number
  alreadyOff: boolean
}

/**
 * Suppress a single email across all three audience sources. Idempotent: records
 * already unsubscribed (and person subs already inactive) are left untouched.
 * Returns how many records were flipped so the endpoint can report + so the flow
 * can distinguish "opted you out" from "you were already unsubscribed".
 */
export async function suppressEmailEverywhere(
  services: UnsubServices,
  email: string,
  at: string
): Promise<SuppressResult> {
  const { personService, customerService, socialsService } = services
  const target = email.toLowerCase()
  let persons = 0
  let customers = 0
  let leads = 0

  // Persons — subscription inactive + metadata.unsubscribed
  const people: any[] = await personService
    .listPeople({ email: target }, { relations: ["subscribed"] })
    .catch(() => [])
  for (const p of people) {
    const sub = p.subscribed
    const subNeedsOff = sub && sub.subscription_status !== "inactive"
    const nextMeta = unsubscribeMetadata(p.metadata, at)
    if (!subNeedsOff && !nextMeta) continue
    if (subNeedsOff) {
      await personService.updatePersonSubs({
        id: sub.id,
        subscription_status: "inactive",
        email_subscribed: "false",
      })
    }
    if (nextMeta) await personService.updatePeople({ id: p.id, metadata: nextMeta })
    persons++
  }

  // Customers — metadata.unsubscribed
  const custs: any[] = await customerService
    .listCustomers({ email: target }, { select: ["id", "email", "metadata"] })
    .catch(() => [])
  for (const c of custs) {
    const nextMeta = unsubscribeMetadata(c.metadata, at)
    if (!nextMeta) continue
    await customerService.updateCustomers(c.id, { metadata: nextMeta })
    customers++
  }

  // Leads — metadata.unsubscribed (sales status untouched)
  const lds: any[] = await socialsService
    .listLeads({ email: target }, { select: ["id", "email", "metadata"] })
    .catch(() => [])
  for (const l of lds) {
    const nextMeta = unsubscribeMetadata(l.metadata, at)
    if (!nextMeta) continue
    await socialsService.updateLeads({ id: l.id, metadata: nextMeta })
    leads++
  }

  const suppressed = persons + customers + leads
  const found = people.length + custs.length + lds.length
  return {
    email: target,
    suppressed,
    persons,
    customers,
    leads,
    // Already off = we matched at least one record but flipped none.
    alreadyOff: suppressed === 0 && found > 0,
  }
}
