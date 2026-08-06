/**
 * Destination classification shared by every carrier adapter.
 *
 * This lived in `shiprocket/client.ts` because Shiprocket was the first carrier
 * to need it, but "is this shipment leaving India" is not a Shiprocket fact —
 * it decides which product a carrier has to be driven through, and a carrier
 * that has no export product at all needs it to refuse the job. Re-exported
 * from `shiprocket/client` so existing imports keep working.
 */

/** True when a shipment's destination country is outside India. */
export function isInternationalDestination(country?: string): boolean {
  const raw = (country || "").trim()
  if (!raw) return false
  return !/^(in|india)$/i.test(raw)
}
