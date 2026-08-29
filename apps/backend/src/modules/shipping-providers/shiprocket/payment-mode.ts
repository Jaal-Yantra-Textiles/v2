import { isInternationalDestination } from "../destination"

/**
 * Which payment mode a Shiprocket shipment is created with — PURE, so the rule
 * that decides whether a parcel can be handed over at all is testable without a
 * container, an order or a live Shiprocket account.
 *
 * Split out for the same reason `deriveShiprocketRateContext` was: this was
 * derived inline in `createFulfillment` and got something wrong that nothing
 * could see.
 *
 * ## The defect
 *
 * The mode came from `payment_status` alone — `captured`/`paid` meant prepaid,
 * and EVERYTHING else meant COD. On a domestic lane that is a real choice.
 *
 * On a cross-border lane it is not a choice at all. Shiprocket has no
 * international COD product, and `buildInternationalCreateBody` throws
 * `"Shiprocket does not support COD for international shipments"` the moment it
 * sees that value. So the fallback never produced a COD shipment — it produced
 * NO shipment. Creating the fulfilment failed outright for every international
 * order whose payment had not settled to `captured` at that instant, which
 * includes the ordinary authorised-but-uncaptured card.
 *
 * ## Why forcing prepaid is not papering over an unpaid order
 *
 * Prepaid is the only mode the lane supports. The alternatives were a prepaid
 * shipment or no shipment — never a COD one. Nothing here touches the payment
 * status, which still says exactly what it said; `warn_uncaptured` exists so an
 * unsettled international shipment is visible rather than silent.
 */
export type ShipmentPaymentMode = {
  payment_mode: "prepaid" | "cod"
  /** The amount to collect. Undefined on prepaid — never 0, which is an amount. */
  cod_amount?: number
  /**
   * International, and the payment has NOT settled. The shipment is still
   * created — prepaid is the only option — but the caller should say so.
   */
  warn_uncaptured: boolean
  international: boolean
}

/** The statuses that mean the money is actually in. */
const SETTLED = new Set(["captured", "paid"])

export function resolveShipmentPaymentMode(input: {
  payment_status?: unknown
  destination_country_code?: unknown
  /** What COD would collect. Ignored on a prepaid shipment. */
  sub_total: number
}): ShipmentPaymentMode {
  const destinationCountry = String(input.destination_country_code || "")
    .trim()
    .toUpperCase()

  const international = isInternationalDestination(destinationCountry)
  const settled = SETTLED.has(String(input.payment_status || ""))

  /**
   * 🔑 An ABSENT country counts as domestic, matching
   * `deriveShiprocketRateContext` — `isInternationalDestination("")` is false.
   * The two derivations must agree: one saying "international" while the other
   * says "domestic" is how a parcel gets quoted on one product and shipped on
   * another.
   */
  if (international) {
    return {
      payment_mode: "prepaid",
      cod_amount: undefined,
      warn_uncaptured: !settled,
      international: true,
    }
  }

  if (settled) {
    return {
      payment_mode: "prepaid",
      cod_amount: undefined,
      warn_uncaptured: false,
      international: false,
    }
  }

  return {
    payment_mode: "cod",
    cod_amount: input.sub_total,
    warn_uncaptured: false,
    international: false,
  }
}
