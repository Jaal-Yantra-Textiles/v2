import type { CreateShipmentInput } from "./provider-interface"

/**
 * DTDC refuses a booking whose description is 250 characters or longer
 * ("Description length must be less than 250 characters").
 */
export const DTDC_DESCRIPTION_MAX = 249

/**
 * The description DTDC will accept for a shipment.
 *
 * The DTDC plugin falls back to every item name joined with ", " — an inventory
 * order of 18 fabrics runs well past the limit, and the booking is refused
 * after the service and address have already passed (seen on prod, HR
 * Handloom, 2026-10-13). Keep whole names while they fit and count the rest,
 * so the label still says what is in the box.
 */
export function dtdcDescription(input: CreateShipmentInput): string {
  const given = String(input.product_description ?? "").trim()
  if (given) return given.slice(0, DTDC_DESCRIPTION_MAX)

  const names = (input.items ?? [])
    .map((i) => String(i.name ?? "").trim())
    .filter(Boolean)
  const all = names.join(", ")
  if (all.length <= DTDC_DESCRIPTION_MAX) return all

  let kept = ""
  for (let n = 0; n < names.length; n++) {
    const next = kept ? `${kept}, ${names[n]}` : names[n]
    const suffix = ` +${names.length - n - 1} more`
    if (next.length + suffix.length > DTDC_DESCRIPTION_MAX) {
      if (!kept) return names[n].slice(0, DTDC_DESCRIPTION_MAX)
      return `${kept} +${names.length - n} more`
    }
    kept = next
  }
  return kept
}
