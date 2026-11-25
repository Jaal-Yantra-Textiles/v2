import { briefChoiceOwnershipError } from "../brief-choice-ownership"

const rateOwner = new Map([
  ["pcrate_sharlho", "partner_sharlho"],
  ["pcrate_bodhi", "partner_bodhi"],
])
const sampleOwner = new Map([["pcap_sharlho", "partner_sharlho"]])

describe("briefChoiceOwnershipError (#2608)", () => {
  it("accepts a rate and samples that belong to the choice's partner", () => {
    expect(
      briefChoiceOwnershipError(
        [{ partner_id: "partner_sharlho", rate_id: "pcrate_sharlho", sample_ids: ["pcap_sharlho"] }],
        rateOwner,
        sampleOwner
      )
    ).toBeNull()
  })

  it("accepts a choice with no rate (we'll confirm)", () => {
    expect(briefChoiceOwnershipError([{ partner_id: "partner_sharlho", rate_id: null }], rateOwner, sampleOwner)).toBeNull()
  })

  it("refuses another workshop's rate under this partner's name", () => {
    expect(
      briefChoiceOwnershipError([{ partner_id: "partner_sharlho", rate_id: "pcrate_bodhi" }], rateOwner, sampleOwner)
    ).toBe("Rate pcrate_bodhi belongs to another partner, not partner_sharlho")
  })

  it("refuses an unknown rate", () => {
    expect(
      briefChoiceOwnershipError([{ partner_id: "partner_sharlho", rate_id: "pcrate_gone" }], rateOwner, sampleOwner)
    ).toBe("Rate pcrate_gone not found")
  })

  it("refuses another workshop's sample", () => {
    expect(
      briefChoiceOwnershipError([{ partner_id: "partner_bodhi", sample_ids: ["pcap_sharlho"] }], rateOwner, sampleOwner)
    ).toBe("Sample pcap_sharlho belongs to another partner, not partner_bodhi")
  })
})
