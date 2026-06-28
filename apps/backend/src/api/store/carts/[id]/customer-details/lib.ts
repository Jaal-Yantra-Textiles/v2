/**
 * Pure assembly of a flat customer-onboarding payload into the cart update
 * shape Medusa expects (email + shipping/billing address objects). Flat input is
 * far easier for an LLM to fill from a conversation than nested JSON; this keeps
 * the mapping (and the name-splitting + billing-mirrors-shipping default) pure
 * and unit-testable. The route does the workflow I/O.
 */
export type CustomerDetailsInput = {
  name?: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  company?: string
  address_1?: string
  address_2?: string
  city?: string
  province?: string
  postal_code?: string
  country_code?: string
  billing_same_as_shipping?: boolean
  billing_address?: Record<string, any>
}

export type CartUpdatePayload = {
  email?: string
  shipping_address?: Record<string, any>
  billing_address?: Record<string, any>
}

/** Split a free-form full name into first/last (everything after the first token). */
export function splitName(
  name?: string,
  first?: string,
  last?: string
): { first_name?: string; last_name?: string } {
  if (first || last) {
    return { first_name: first || undefined, last_name: last || undefined }
  }
  const trimmed = (name || "").trim()
  if (!trimmed) return {}
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { first_name: parts[0] }
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") }
}

/** Drop undefined/empty keys so we never overwrite cart fields with blanks. */
function compact(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v
  }
  return out
}

/**
 * Build the cart update payload. Returns `{ payload, missing }` where `missing`
 * lists required shipping fields the agent still needs to ask the user for (so
 * the route can 400 with a clear, actionable message instead of half-updating).
 */
export function buildCartUpdate(input: CustomerDetailsInput): {
  payload: CartUpdatePayload
  missing: string[]
} {
  const { first_name, last_name } = splitName(
    input.name,
    input.first_name,
    input.last_name
  )

  const shipping = compact({
    first_name,
    last_name,
    phone: input.phone,
    company: input.company,
    address_1: input.address_1,
    address_2: input.address_2,
    city: input.city,
    province: input.province,
    postal_code: input.postal_code,
    country_code: input.country_code?.toLowerCase(),
  })

  // What a shippable address needs. Email is required to make the cart
  // recoverable + to send confirmations.
  const REQUIRED: Array<[keyof CartUpdatePayload | string, unknown]> = [
    ["email", input.email],
    ["address_1", input.address_1],
    ["city", input.city],
    ["postal_code", input.postal_code],
    ["country_code", input.country_code],
    ["name", first_name],
  ]
  const missing = REQUIRED.filter(([, v]) => !v).map(([k]) => String(k))

  const payload: CartUpdatePayload = {}
  if (input.email) payload.email = input.email
  if (Object.keys(shipping).length) payload.shipping_address = shipping

  if (input.billing_address) {
    payload.billing_address = compact(input.billing_address)
  } else if (input.billing_same_as_shipping !== false && payload.shipping_address) {
    payload.billing_address = { ...payload.shipping_address }
  }

  return { payload, missing }
}
