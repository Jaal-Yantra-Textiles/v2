/**
 * Blue Dart (DHL India) API surface constants.
 *
 * Two-layer auth, which is the thing that trips everyone up:
 *   Layer 1 — the API gateway (`clientID` / `clientSecret` headers) mints a JWT.
 *   Layer 2 — the shipping account (`LoginID` / `LicenceKey` / `Customercode`)
 *             travels in the request BODY, inside a `Profile` object.
 * Having a valid JWT tells you nothing about whether the shipping account is
 * right, and vice versa.
 */

export const BLUEDART_CARRIER_ID = "bluedart"

export const BLUEDART_BASE_URL = "https://apigateway.bluedart.com"
export const BLUEDART_SANDBOX_URL = "https://apigateway-sandbox.bluedart.com"

export const BLUEDART_PATHS = {
  token: "/in/transportation/token/v1/login",
  generateWaybill: "/in/transportation/waybill/v1/GenerateWayBill",
  cancelWaybill: "/in/transportation/waybill/v1/CancelWaybill",
  registerPickup: "/in/transportation/pickup/v1/RegisterPickup",
  /**
   * ⚠️ Two traps in one line, both cost real time on 2026-08-13.
   *
   *  1. It is NOT "/pickup/v1/CancelPickup" by symmetry with RegisterPickup —
   *     cancellation has its own top-level `cancel-pickup` segment.
   *  2. The published curl stops at `/cancel-pickup/v1`, and that path 415s.
   *     The operation name must still be appended.
   *
   * ⚠️ A wrong path here answers **415 "Access to the method is not allowed"**,
   * which reads exactly like an unsubscribed-API error and sent us looking for
   * a subscription problem that did not exist. On this gateway, treat 415 as
   * "wrong path", not "no access". Verified: this path returns
   * `{"CancelPickupResult":{"IsError":false,"Status":[{"StatusCode":"CancelSuccess"}]}}`.
   */
  cancelPickup: "/in/transportation/cancel-pickup/v1/CancelPickup",
  servicesForPincode: "/in/transportation/finder/v1/GetServicesforPincode",
  tracking: "/in/transportation/tracking/v1",
} as const

/**
 * Product codes. `H` is the international one (IPC) — the reason Blue Dart can
 * do what Delhivery's Express integration cannot, and why this adapter has no
 * `assertDomestic` guard.
 *
 * ⚠️ Availability is per-origin-area, not global: product `A` is NOT available
 * outbound from DHM (Dharamshala, 176215) while `D` is. Never hardcode a
 * product for a lane without checking `GetServicesforPincode` first.
 */
export const BLUEDART_PRODUCT = {
  /** Domestic priority (DART PLUS / TDD). Available outbound from DHM. */
  domestic: "D",
  /** Apex — NOT available outbound from DHM. */
  apex: "A",
  /** International IPC (Expedited / Standard). */
  international: "H",
  /** International import. */
  internationalImport: "I",
} as const

/** Sub-product for the international product. */
export const BLUEDART_INTL_SUBPRODUCT = "IPC-Expedited"

/** Pickup registration requires a non-empty SubProducts array. */
export const BLUEDART_PICKUP_SUBPRODUCTS = ["TDD"]

/** Default parcel dimensions (cm). Blue Dart REJECTS a waybill with no Dimensions. */
export const BLUEDART_DEFAULT_DIMENSIONS = {
  length: 10,
  breadth: 10,
  height: 10,
}

/**
 * Microsoft-JSON date, which is what every Blue Dart date field expects:
 * `/Date(1786657200000)/`. A plain ISO string is silently rejected.
 */
export function toMsJsonDate(date: Date | string | number): string {
  const ms =
    date instanceof Date
      ? date.getTime()
      : typeof date === "number"
        ? date
        : new Date(date).getTime()
  return `/Date(${ms})/`
}

/** `HH:mm` → `HHmm`, the form the waybill's `PickupTime` wants. */
export function toBlueDartTime(time?: string): string {
  const raw = String(time || "16:00").replace(/[^0-9]/g, "")
  return raw.slice(0, 4).padStart(4, "0")
}

/** Grams → the two-decimal KG string Blue Dart bills on. */
export function gramsToKgString(grams?: number): string {
  const kg = Math.max(Number(grams) || 0, 1) / 1000
  // Blue Dart treats 0 as a missing weight and rejects the waybill, so the
  // floor is a token 0.01 kg rather than 0.
  return Math.max(kg, 0.01).toFixed(2)
}
