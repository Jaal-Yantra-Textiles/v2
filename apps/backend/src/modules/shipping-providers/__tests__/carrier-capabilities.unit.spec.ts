import {
  CARRIER_CAPABILITIES,
  capabilitiesCoverSupportedCarriers,
  carrierCanDeclareDdp,
  findCarrierCapability,
  groupCarriersByLane,
} from "../carrier-capabilities"
import { buildCarrierAvailability } from "../carrier-availability"

describe("carrier capabilities", () => {
  it("covers every carrier the resolver claims to support", () => {
    // The two lists drift silently otherwise: a carrier gains a client and the
    // picker never learns about it.
    const { ok, missing } = capabilitiesCoverSupportedCarriers()
    expect(missing).toEqual([])
    expect(ok).toBe(true)
  })

  it("keeps RATING and SHIPPING separate — Blue Dart ships both lanes, rates neither", () => {
    // The whole reason for two axes. Collapsing them would offer Blue Dart as a
    // live-rate carrier and then quote every lane at the fallback.
    const bluedart = findCarrierCapability("bluedart")!
    expect(bluedart.international.can_ship).toBe(true)
    expect(bluedart.international.can_rate).toBe(false)
    expect(bluedart.domestic.can_rate).toBe(false)
  })

  it("records that Delhivery cannot go international at all", () => {
    const delhivery = findCarrierCapability("delhivery")!
    expect(delhivery.domestic.can_rate).toBe(true)
    expect(delhivery.international.can_ship).toBe(false)
    expect(delhivery.international.can_rate).toBe(false)
  })

  it("has Shiprocket as the only carrier that rates cross-border", () => {
    const { international } = groupCarriersByLane()
    expect(international.rating.map((c) => c.id)).toEqual(["shiprocket"])
  })

  it("surfaces DTDC as un-integrated rather than hiding it", () => {
    const dtdc = CARRIER_CAPABILITIES.find((c) => c.id === "dtdc")!
    expect(dtdc.integrated).toBe(false)
    expect(groupCarriersByLane().unavailable.map((c) => c.id)).toContain("dtdc")
  })
})

describe("buildCarrierAvailability", () => {
  it("marks a registered+linked carrier enabled, and an unregistered one blocked", () => {
    const { carriers } = buildCarrierAvailability({
      registeredProviderIds: ["shiprocket_shiprocket"],
      linkedProviderIds: ["shiprocket_shiprocket"],
    })

    const shiprocket = carriers.find((c) => c.id === "shiprocket")!
    expect(shiprocket.enabled).toBe(true)
    expect(shiprocket.blocked_reason).toBeNull()

    // Delhivery exists as an adapter but has no credentials on this deployment.
    const delhivery = carriers.find((c) => c.id === "delhivery")!
    expect(delhivery.registered).toBe(false)
    expect(delhivery.enabled).toBe(false)
    expect(delhivery.blocked_reason).toContain("credentials")
  })

  it("never lists a blocked carrier as selectable for a lane", () => {
    // A picker built from these lists cannot offer an unusable row.
    const { domestic, international } = buildCarrierAvailability({
      registeredProviderIds: [],
      linkedProviderIds: [],
    })

    expect(domestic.rating).toEqual([])
    expect(domestic.shipping).toEqual([])
    expect(international.rating).toEqual([])
  })

  it("distinguishes registered-but-not-linked from linked", () => {
    const { carriers } = buildCarrierAvailability({
      registeredProviderIds: ["delhivery_delhivery"],
      linkedProviderIds: [],
    })

    const delhivery = carriers.find((c) => c.id === "delhivery")!
    expect(delhivery.registered).toBe(true)
    expect(delhivery.enabled).toBe(false)
    // Registered means selectable — the partner simply has not switched it on.
    expect(delhivery.blocked_reason).toBeNull()
  })
})

/**
 * DDP by carrier (#1447).
 *
 * 🔴 The distinction this pins down: DECLARING a shipment DDP is code, being
 * BILLED the duty is a commercial arrangement. A quote sold DDP that ships on a
 * carrier we cannot declare it to is a promise someone keeps by hand — and the
 * failure mode is silent, landing on the buyer at their own border weeks after
 * they paid.
 */
describe("who can be told a shipment is DDP", () => {
  it("says only Blue Dart today — it is the one payload with an incoterm", () => {
    expect(carrierCanDeclareDdp("bluedart")).toBe(true)
    // Shiprocket's DDP is real but gated on CSB-5 seller KYC; every lane
    // reports ddp_tag: false. Delhivery's lives on Cross Border, which is a
    // panel selection on a service we hold no API for.
    expect(carrierCanDeclareDdp("shiprocket")).toBe(false)
    expect(carrierCanDeclareDdp("delhivery")).toBe(false)
  })

  it("🔴 answers FALSE for a carrier it does not know", () => {
    // The safe answer routes the promise to a human. Guessing true would let a
    // DDP sale ship duty-unpaid without anyone noticing.
    expect(carrierCanDeclareDdp("dhl")).toBe(false)
    expect(carrierCanDeclareDdp(null)).toBe(false)
    expect(carrierCanDeclareDdp(undefined)).toBe(false)
  })
})
