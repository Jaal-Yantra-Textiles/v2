/**
 * Human names for the carrier ids the backend stores on a shipment row.
 * Unknown ids fall back to a title-cased version of the id ("blue_dart" →
 * "Blue Dart") so a new backend carrier never renders as a raw snake_case id.
 */
const CARRIER_LABELS: Record<string, string> = {
  shiprocket: "Shiprocket",
  delhivery: "Delhivery",
  dtdc: "DTDC",
  india_post: "India Post",
}

export const carrierLabel = (id?: string | null): string => {
  const key = String(id || "").trim().toLowerCase()
  if (!key) return ""
  if (CARRIER_LABELS[key]) return CARRIER_LABELS[key]
  return key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/** Inventory shipment waiting for our team to book it (no AWB, no label yet). */
export const isBookingPending = (shipment?: { status?: unknown } | null): boolean =>
  String(shipment?.status || "").toLowerCase() === "booking_pending"
