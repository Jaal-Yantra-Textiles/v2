/**
 * Pure helpers for deriving a Person identity from an order (#664).
 *
 * Shared by the live purchase-conversion workflow (the forward fix in
 * resolve-person) and the `backfill-order-persons` maintenance job. No
 * container / IO here so the logic is unit-testable in isolation.
 *
 * Background: ad-planning scoring keys entirely off `person_id`. Manual orders
 * historically had no matching Person row, so `resolvePersonStep` returned null
 * and every downstream score (CLV / engagement / churn) silently skipped. The
 * fix upserts a Person from the order's email + name; this module is the name
 * derivation that both the forward fix and the backfill reuse.
 */

export type OrderIdentitySource = {
  email?: string | null
  billing_address?: { first_name?: string | null; last_name?: string | null } | null
  shipping_address?: { first_name?: string | null; last_name?: string | null } | null
  customer?: { first_name?: string | null; last_name?: string | null } | null
}

export type PersonName = { first_name: string; last_name: string }

/**
 * Split a free-text full name into {first,last}; the last name is the remainder
 * after the first token (so "Jane Q Public" → first "Jane", last "Q Public").
 */
export function splitFullName(full: string): PersonName {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first_name: "", last_name: "" }
  if (parts.length === 1) return { first_name: parts[0], last_name: "" }
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") }
}

/**
 * An order email is usable for Person upsert only if it actually looks like an
 * address. Mirrors the loose `includes("@")` check already used across the
 * codebase (auto-subscribe-customers.ts) rather than a strict RFC validator.
 */
export function isUsableEmail(email?: string | null): boolean {
  const e = (email ?? "").trim()
  return e.includes("@") && !e.startsWith("@") && !e.endsWith("@")
}

/**
 * Derive a best-effort {first_name,last_name} for a Person created from an order.
 * Precedence: billing address → shipping address → customer → email local-part.
 * Always returns strings (never null) — Person.first_name/last_name are non-null
 * `text` columns, so an empty string is the correct "unknown" value.
 */
export function derivePersonName(order: OrderIdentitySource): PersonName {
  const candidates = [order.billing_address, order.shipping_address, order.customer]
  for (const c of candidates) {
    const first = (c?.first_name ?? "").trim()
    const last = (c?.last_name ?? "").trim()
    if (first || last) return { first_name: first, last_name: last }
  }

  // Last resort: turn the email local-part into a readable name
  // ("jane.doe@x.com" → first "Jane", last "Doe").
  const email = (order.email ?? "").trim()
  if (isUsableEmail(email)) {
    const local = email.split("@")[0].replace(/[._+-]+/g, " ")
    const split = splitFullName(local)
    // Title-case the derived tokens so they don't read as raw slugs.
    return {
      first_name: titleCase(split.first_name),
      last_name: titleCase(split.last_name),
    }
  }

  return { first_name: "", last_name: "" }
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}
