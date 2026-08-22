import { SUPPORTED_CARRIERS } from "./resolver"

/**
 * What each carrier can actually DO, split by lane (#1417).
 *
 * ## Why two axes and not one
 *
 * "Supports international" is not one fact. A carrier can carry a parcel
 * abroad and still be unable to PRICE the lane, and the two failures look
 * nothing alike: an unratable carrier shows the buyer a fallback number, an
 * unshippable one fails at label time, long after the buyer has paid.
 *
 * Blue Dart is exactly that case — it ships domestic AND international (product
 * code `H`/IPC), but its adapter has no `getRates` at all, so it can never
 * appear as a calculated option. Collapsing this into a single "supports
 * international" flag would have offered it as a live-rate carrier and then
 * quoted every lane at the fallback.
 *
 * ## This is derived from the adapters, not aspirational
 *
 * Every flag below is what the code in `shipping-providers/<carrier>` actually
 * implements today, verified against the adapters:
 *
 * · **Shiprocket** — rates and ships both lanes. `getRates` branches on the
 *   destination country into `/international/courier/serviceability`.
 * · **Delhivery** — domestic only, and it REFUSES international explicitly:
 *   this integration drives the domestic Express API, while exports run on
 *   Delhivery Cross Border, a separate service with no rate API. That refusal
 *   is why Shiprocket is the cross-border rate source for an Indian origin.
 * · **Blue Dart** — ships both lanes, rates NEITHER (no `getRates`).
 * · **DTDC** — not integrated. Listed so the gap is visible in the UI rather
 *   than being a carrier nobody remembers we do not have.
 *
 * 🔑 When a carrier gains a capability, this table and the adapter must move
 * together. A flag set here that the adapter cannot honour is worse than no
 * flag: it puts a carrier in front of a buyer that cannot complete the job.
 */

export type CarrierLaneCapability = {
  /** Can return live rates for this lane (`getRates` handles it). */
  can_rate: boolean
  /** Can create a shipment/label for this lane. */
  can_ship: boolean
}

export type CarrierCapability = {
  id: string
  label: string
  /** False when there is no adapter at all — surfaced, not hidden. */
  integrated: boolean
  /** True when the platform holds the account; false = partner brings keys. */
  platform_account: boolean
  domestic: CarrierLaneCapability
  international: CarrierLaneCapability
  /**
   * Can the adapter DECLARE the shipment delivered-duty-paid (#1447)?
   *
   * 🔑 This is about what we can tell the carrier, not about whether the
   * account is set up to be billed the duty. Declaring is code; being billed is
   * a commercial arrangement with the carrier, and one does not imply the
   * other. A quote sold DDP that ships on a carrier with `false` here is a
   * promise being kept by hand — which is the current state of every lane.
   */
  can_declare_ddp: boolean
  /** Why a lane is unavailable, when that needs explaining to a human. */
  notes?: string
}

export const CARRIER_CAPABILITIES: CarrierCapability[] = [
  {
    id: "shiprocket",
    label: "Shiprocket",
    integrated: true,
    platform_account: true,
    domestic: { can_rate: true, can_ship: true },
    international: { can_rate: true, can_ship: true },
    // `ddp_tag`, `ioss_fee` and `tariff` are on the serviceability RESPONSE and
    // are absent from the published collection entirely. Every lane currently
    // returns `ddp_tag: false`, gated account-wide on `csb5_seller_kyc: false`;
    // accepting the DDP agreement in the panel did not change it.
    can_declare_ddp: false,
    notes:
      "Rates and ships both lanes. For an Indian origin this is the cross-border rate source, because Delhivery's export product has no rate API. DDP is a real Shiprocket capability but is gated on CSB-5 seller KYC — every lane reports ddp_tag: false today.",
  },
  {
    id: "delhivery",
    label: "Delhivery",
    integrated: true,
    platform_account: true,
    domestic: { can_rate: true, can_ship: true },
    international: { can_rate: false, can_ship: false },
    // Delhivery support (2026-08-22) confirms DDP exists on their cross-border
    // product: "For Commercial please select the DDP mode from incoterm", and
    // "Free on domicile" for sample shipments. Both are PANEL selections on
    // Delhivery Cross Border. The domestic Express API this adapter drives has
    // no incoterm field at all, so we cannot set it from code.
    can_declare_ddp: false,
    notes:
      "Domestic (Express) only. International exports run on Delhivery Cross Border — a separate service we have no API access to — so the adapter refuses cross-border rather than failing at label time. DDP exists there (support: select DDP from incoterm for commercial, Free on domicile for samples) but only as a panel selection; nothing in the API we hold can declare it.",
  },
  {
    id: "bluedart",
    label: "Blue Dart",
    integrated: true,
    platform_account: true,
    domestic: { can_rate: false, can_ship: true },
    international: { can_rate: false, can_ship: true },
    // The only adapter that can say it: `IncotermCode` on the international
    // services block, which followed the sale as of #1447 (it was hardcoded
    // "DAP" — duty unpaid — before that).
    can_declare_ddp: true,
    notes:
      "Ships both lanes (international via product code H/IPC) but cannot quote either — the adapter implements no rate call, so it can only be used as a flat-priced or manually-priced option. It is the one carrier whose payload carries an incoterm, so a DDP sale can at least be DECLARED DDP; whether the account is billed the duty is a commercial arrangement, not a flag.",
  },
  {
    id: "dtdc",
    label: "DTDC",
    integrated: false,
    platform_account: false,
    domestic: { can_rate: false, can_ship: false },
    international: { can_rate: false, can_ship: false },
    can_declare_ddp: false,
    notes: "Not integrated. No adapter exists yet.",
  },
]

/** The Medusa fulfillment-provider id a carrier registers under. */
export function fulfillmentProviderId(carrierId: string): string {
  return `${carrierId}_${carrierId}`
}

/**
 * Can this carrier be told the shipment is DDP?
 *
 * 🔴 Unknown carrier ⇒ FALSE. The safe answer is "we cannot declare it", which
 * routes the promise to a human; guessing true would let a DDP sale ship
 * silently as duty-unpaid, and the buyer finds out at their border.
 */
export function carrierCanDeclareDdp(carrierId?: string | null): boolean {
  return Boolean(findCarrierCapability(carrierId)?.can_declare_ddp)
}

export function findCarrierCapability(
  carrierId?: string | null
): CarrierCapability | undefined {
  const id = String(carrierId || "").toLowerCase()
  return CARRIER_CAPABILITIES.find((c) => c.id === id)
}

/**
 * Split the carriers by lane for a picker.
 *
 * `rating` and `shipping` are separate lists on purpose — a UI that shows one
 * combined list has to pick which failure to hide, and both matter. `shipping`
 * is the superset: a carrier that can rate can always ship, but not the reverse.
 */
export function groupCarriersByLane(
  carriers: CarrierCapability[] = CARRIER_CAPABILITIES
): {
  domestic: { rating: CarrierCapability[]; shipping: CarrierCapability[] }
  international: { rating: CarrierCapability[]; shipping: CarrierCapability[] }
  unavailable: CarrierCapability[]
} {
  const usable = carriers.filter((c) => c.integrated)

  return {
    domestic: {
      rating: usable.filter((c) => c.domestic.can_rate),
      shipping: usable.filter((c) => c.domestic.can_ship),
    },
    international: {
      rating: usable.filter((c) => c.international.can_rate),
      shipping: usable.filter((c) => c.international.can_ship),
    },
    unavailable: carriers.filter((c) => !c.integrated),
  }
}

/**
 * 🔴 Guard: every carrier the resolver claims to support must appear here.
 *
 * The two lists drift silently otherwise — a carrier gains a client and the
 * picker never learns about it, or this table names one the resolver cannot
 * build. Exported rather than run at import time so it fails a TEST rather than
 * a boot.
 */
export function capabilitiesCoverSupportedCarriers(): {
  ok: boolean
  missing: string[]
} {
  const known = new Set(CARRIER_CAPABILITIES.map((c) => c.id))
  const missing = SUPPORTED_CARRIERS.filter((c) => !known.has(c))
  return { ok: missing.length === 0, missing }
}
