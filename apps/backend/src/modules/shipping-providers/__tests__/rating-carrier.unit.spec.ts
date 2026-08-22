import {
  carrierIdFromProviderId,
  pickRatingCarrier,
} from "../rating-carrier"

/**
 * 🔴 The defect: `buildShippingEstimate` defaulted to Shiprocket whenever no
 * carrier was named — which was EVERY partner quote ever minted. A partner who
 * ships Delhivery, and only Delhivery, had their freight quoted by a company
 * they do not use. A real rate, a real lane, the wrong carrier: plausible
 * enough that nothing about the number gave it away, and guaranteed to
 * disagree with the invoice that eventually arrives.
 */
describe("pickRatingCarrier", () => {
  it("uses the partner's own enabled carrier instead of the platform default", () => {
    expect(
      pickRatingCarrier({
        enabledCarrierIds: ["delhivery"],
        lane: "domestic",
      })
    ).toBe("delhivery")
  })

  it("an explicit choice always wins — that is what the admin picker is", () => {
    expect(
      pickRatingCarrier({
        explicit: "shiprocket",
        enabledCarrierIds: ["delhivery"],
        lane: "domestic",
      })
    ).toBe("shiprocket")
  })

  it("passes 'manual' straight through — asking nobody is a real choice", () => {
    expect(
      pickRatingCarrier({
        explicit: "manual",
        enabledCarrierIds: ["delhivery"],
        lane: "domestic",
      })
    ).toBe("manual")
  })

  it("🔴 skips a carrier that cannot RATE this lane, even when enabled", () => {
    // Delhivery refuses cross-border outright; Blue Dart ships abroad and
    // quotes nothing. Picking either would produce no rates at all and read as
    // "this lane is unserviceable".
    expect(
      pickRatingCarrier({
        enabledCarrierIds: ["delhivery"],
        lane: "international",
      })
    ).toBeNull()
    expect(
      pickRatingCarrier({ enabledCarrierIds: ["bluedart"], lane: "domestic" })
    ).toBeNull()
  })

  it("prefers the one that CAN rate when several are enabled", () => {
    expect(
      pickRatingCarrier({
        enabledCarrierIds: ["bluedart", "shiprocket"],
        lane: "international",
      })
    ).toBe("shiprocket")
  })

  it("is stable when two enabled carriers could both rate the lane", () => {
    // A link list is unordered. "Which carrier quoted this" flipping between
    // two mints of the same basket is a difference nobody can explain to a
    // buyer, so the capability table's order decides, not the query's.
    const a = pickRatingCarrier({
      enabledCarrierIds: ["delhivery", "shiprocket"],
      lane: "domestic",
    })
    const b = pickRatingCarrier({
      enabledCarrierIds: ["shiprocket", "delhivery"],
      lane: "domestic",
    })
    expect(a).toBe(b)
  })

  it("hands the decision back when the partner has enabled nothing", () => {
    // Null, not a guess: the caller falls back to the platform default, because
    // a quote with no freight number is worse than one rated on our account.
    expect(pickRatingCarrier({ enabledCarrierIds: [], lane: "domestic" })).toBeNull()
  })
})

describe("carrierIdFromProviderId", () => {
  it("reads the carrier out of a Medusa provider id", () => {
    expect(carrierIdFromProviderId("delhivery_delhivery")).toBe("delhivery")
    expect(carrierIdFromProviderId("shiprocket_shiprocket")).toBe("shiprocket")
  })

  it("refuses a provider that is not one of ours", () => {
    // `manual_manual` and core's own providers must not be mistaken for a
    // carrier we can ask for rates.
    expect(carrierIdFromProviderId("manual_manual")).toBeNull()
    expect(carrierIdFromProviderId("")).toBeNull()
    expect(carrierIdFromProviderId(null)).toBeNull()
  })
})
