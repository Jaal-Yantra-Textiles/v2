// Pure helpers for the "region request → admin" email (#576 slice C).
// Side-effect free so recipient resolution + template-data assembly are
// unit-testable without booting Medusa or a notification provider.
//
// Trigger: POST /store/contact-region-request (the storefront "we don't ship
// here yet" fallback form). The route already drops a feed notification for the
// partner; this slice additionally alerts an ops/admin inbox by email so the
// lead isn't only visible inside the admin activity feed.

export interface RegionRequestRecipientEnv {
  /** Primary, purpose-built recipient (set in prod SSM). */
  REGION_REQUEST_NOTIFY_EMAIL?: string | null
  /** Generic admin alert inbox, if the platform has one configured. */
  ADMIN_NOTIFY_EMAIL?: string | null
  /** Last-resort floor so a region request never silently no-ops. */
  MAILJET_FROM_EMAIL?: string | null
}

export interface RegionRequestRecipient {
  email: string
  /** Which env key supplied the address (for the route log). */
  source: string
}

/**
 * Resolve the admin recipient for a region-request alert (first non-empty,
 * @-containing value wins). Returns null when nothing is configured so the
 * caller can skip the email send without throwing — the feed notification has
 * already captured the lead regardless.
 *
 * Order mirrors `visual-flow-lifecycle-email.ts::resolveRecipient`:
 *   1. REGION_REQUEST_NOTIFY_EMAIL — purpose-built, set in prod SSM
 *   2. ADMIN_NOTIFY_EMAIL          — generic admin alert inbox
 *   3. MAILJET_FROM_EMAIL          — from-address floor the team controls
 */
export function resolveRegionRequestRecipient(
  env: RegionRequestRecipientEnv
): RegionRequestRecipient | null {
  const candidates: Array<[string | null | undefined, string]> = [
    [env.REGION_REQUEST_NOTIFY_EMAIL, "REGION_REQUEST_NOTIFY_EMAIL"],
    [env.ADMIN_NOTIFY_EMAIL, "ADMIN_NOTIFY_EMAIL"],
    [env.MAILJET_FROM_EMAIL, "MAILJET_FROM_EMAIL (fallback)"],
  ]

  for (const [value, source] of candidates) {
    const trimmed = (value || "").trim()
    if (trimmed && trimmed.includes("@")) {
      return { email: trimmed, source }
    }
  }

  return null
}

export interface RegionRequestAdminEmailInput {
  name: string
  email: string
  message?: string | null
  countryCode?: string | null
  productHandle?: string | null
  storeId?: string | null
  storeName?: string | null
  receivedAt?: string | null
}

/**
 * Assemble the Handlebars data for the `region-request-admin` template.
 * Normalises optional fields to safe display values so the compiled template
 * never renders "undefined". `country_code` is upper-cased to match the feed
 * notification title the same request produces.
 */
export function buildRegionRequestAdminEmailData(
  input: RegionRequestAdminEmailInput
): Record<string, any> {
  const countryCode = (input.countryCode || "").trim().toUpperCase()
  const title = countryCode
    ? `Region request: customer in ${countryCode}`
    : "Region request: storefront contact"

  return {
    title,
    name: input.name,
    email: input.email,
    message: (input.message || "").trim() || null,
    country_code: countryCode || null,
    product_handle: (input.productHandle || "").trim() || null,
    store_id: input.storeId || null,
    store_name: (input.storeName || "").trim() || null,
    received_at: input.receivedAt || null,
  }
}
