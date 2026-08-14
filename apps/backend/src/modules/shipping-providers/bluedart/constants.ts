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
  /**
   * The product/sub-product registry — the authoritative answer to "what codes
   * exist", and free to call.
   *
   * ⚠️ POST, unlike the token endpoint which is GET. Body is
   * `{"profile":{"Api_type","LicenceKey","LoginID"}}`.
   *
   * 🔑 Its scope is the PICKUP vocabulary (DHL documents it as feeding Pickup
   * Registration's input params), so it confirms `SubProducts` full names —
   * NOT the waybill's single-character `SubProductCode`. Verified live
   * 2026-08-15; it is what settled `H` above.
   */
  allProductsAndSubProducts:
    "/in/transportation/allproduct/v1/GetAllProductsAndSubProducts",
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
  /**
   * International IPC. ✅ **SETTLED 2026-08-15 — `H` is correct.**
   *
   * The carrier's own registry (`GetAllProductsAndSubProducts`, see below)
   * returns product `H` with exactly two sub-products: `IPC-Expedited` and
   * `IPC-Standard`. That is the international product, and this value has been
   * right since #1286.
   *
   * ⚠️ This RETRACTS the 2026-08-14 conclusion that "`A`, `D`, `E` are the only
   * valid product codes" and that `H`/`I` return `InvalidProductCode`. That came
   * from `GetServicesforPincode`, a *pincode serviceability* call — which this
   * file already suspected of covering domestic products only. The suspicion was
   * correct. Do not "fix" this to `I` or `A`: it would break exports.
   */
  international: "H",
  /**
   * ⚠️ NOT "international import" — that label is wrong and is kept only because
   * nothing sends this value. `GetAllProductsAndSubProducts` lists `I` with
   * sub-products E-Tailing, SII, DTP, Express Easy 6, Express Easy 8, Express
   * Pallete and Imp/EXP — a mixed import/export product, not the IPC one.
   */
  internationalImport: "I",
  /**
   * Surface / ground. Identified 2026-08-15 from its sub-product list (SFC
   * Laptop Box 10, FOD, FOV/DC, DOD, EDL, Express Pallete, Smart Box) — SFC is
   * Surface Freight Cargo. Previously an unidentified valid code.
   */
  surface: "E",
} as const

/**
 * Sub-product for the international product. Max 1 char, A-Z — see the guard in
 * `createShipment`.
 *
 * ⚠️ **STILL UNVERIFIED, and now looking weaker.** Supplied 2026-08-14 as
 * "P = Prepaid, the single-letter sub-product for IPC Expedited". It is not
 * published on developer.dhl.com and Blue Dart support has not confirmed it.
 *
 * `GetAllProductsAndSubProducts` (2026-08-15) names the two real sub-products of
 * product `H` — `IPC-Expedited` and `IPC-Standard` — and "Prepaid" appears
 * nowhere in the carrier's registry. But that registry is the PICKUP
 * vocabulary, which takes full names in a `SubProducts` ARRAY, whereas this
 * field is the waybill's, capped at 1 char A-Z by the documented field limits
 * (#1295). So the registry does NOT settle this value; it only removes the
 * story behind it. `E` (Expedited) and `S` (Standard) are the obvious
 * candidates — inference, not evidence. Left alone deliberately; it is one of
 * the two open questions for Blue Dart support.
 *
 * International is separately blocked on #1223's HS codes, so nothing ships on
 * this until both are resolved.
 */
export const BLUEDART_INTL_SUBPRODUCT = "P"

/**
 * Dox vs NonDox. Everything this platform ships is textiles — goods, never
 * documents — so the parcel value is the only one we use.
 *
 * ⚠️ **UNVERIFIED.** Supplied 2026-08-14: `ProductType` 0 = Docs, 1 = Dutiables
 * (parcel); pickup `DoxNDox` "1" = Dox, "2" = NonDox. Neither enum is published
 * on developer.dhl.com. What IS confirmed is the symptom: with the old values
 * (`ProductType: 0`, `DoxNDox: "1"`), DHL Unified reported order 83's two
 * garments as `productName: "Documents"` — so the old values were wrong.
 *
 * A wrong value here now fails LOUDLY (#1296 surfaces `error-response`), and a
 * rejected waybill costs nothing. Verify on the next real shipment.
 */
export const BLUEDART_PRODUCT_TYPE_PARCEL = 1
export const BLUEDART_PICKUP_DOXNDOX_PARCEL = "2"

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
