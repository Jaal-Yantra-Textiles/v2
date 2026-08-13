/**
 * Carriers the admin shipping routes can drive, and which destinations each can
 * actually reach.
 *
 * Mirrors `apps/partner-ui/.../order-create-shipment-form/constants.ts` — the
 * admin and partner pickers must offer the same set, because they drive the
 * SAME backend (`resolveShippingProvider`, whose `SUPPORTED_CARRIERS` is the
 * real authority). Kept as a small local module rather than imported across
 * apps: the two UIs don't share a package, and duplicating four lines beats a
 * build-graph edge.
 *
 * `domesticOnly` means the integration talks to that carrier's India-only
 * product. Delhivery is the case: we drive its Express last-mile API, while its
 * exports run on Cross Border — a separate Delhivery One service we are not
 * onboarded to. Offering it for a foreign address only produces an opaque
 * carrier error, so it is filtered out of the picker (the backend adapter
 * refuses it too — that's the real guard).
 */
export const SHIPMENT_CARRIERS = [
  { value: "shiprocket", label: "Shiprocket" },
  { value: "delhivery", label: "Delhivery", domesticOnly: true },
  // Blue Dart is NOT domestic-only: product "H" (IPC) is a real export product
  // on the same account, so it is offered for foreign destinations too. It is
  // also the fallback for origins where the other carriers' pickups don't
  // materialise, which is why it was integrated at all.
  { value: "bluedart", label: "Blue Dart" },
] as const

export type ShipmentCarrier = (typeof SHIPMENT_CARRIERS)[number]["value"]

/** True when a destination country is outside India (mirrors the backend). */
export const isInternationalDestination = (country?: string | null): boolean => {
  const raw = (country || "").trim()
  if (!raw) return false
  return !/^(in|india)$/i.test(raw)
}

/** The carriers that can actually ship to a given destination. */
export const carriersForDestination = (country?: string | null) =>
  SHIPMENT_CARRIERS.filter(
    (c) =>
      !("domesticOnly" in c && c.domesticOnly) ||
      !isInternationalDestination(country)
  )

/**
 * Pick a carrier that can serve this destination, keeping the operator's choice
 * when it still can. A picker pre-filled from a previous domestic order must not
 * stay on Delhivery once the address is foreign.
 */
export const resolveSelectableCarrier = (
  selected: string | undefined,
  country?: string | null
): string => {
  const available = carriersForDestination(country)
  if (selected && available.some((c) => c.value === selected)) return selected
  return available[0]?.value || "shiprocket"
}

/** Display label for a carrier id (falls back to the id itself). */
export const carrierLabel = (carrier?: string | null): string =>
  SHIPMENT_CARRIERS.find((c) => c.value === carrier)?.label || carrier || "—"
