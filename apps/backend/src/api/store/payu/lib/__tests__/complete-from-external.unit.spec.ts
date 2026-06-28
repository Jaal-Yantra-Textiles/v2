import {
  buildSessionData,
  resolveCompletionProvider,
} from "../complete-from-external"

describe("resolveCompletionProvider", () => {
  it("prefers the region's PayU provider so the order books a real PayU payment", () => {
    expect(
      resolveCompletionProvider([{ id: "pp_payu_payu", is_enabled: true }])
    ).toBe("pp_payu_payu")
  })

  it("falls back to pp_system_default when no PayU provider is enabled", () => {
    expect(
      resolveCompletionProvider([
        { id: "pp_stripe_stripe", is_enabled: true },
        { id: "pp_system_default", is_enabled: true },
      ])
    ).toBe("pp_system_default")
  })

  it("ignores disabled providers", () => {
    expect(
      resolveCompletionProvider([{ id: "pp_payu_payu", is_enabled: false }])
    ).toBe("pp_system_default")
  })

  it("uses the first enabled provider when neither PayU nor system default exist", () => {
    expect(
      resolveCompletionProvider([{ id: "pp_stripe_stripe", is_enabled: true }])
    ).toBe("pp_stripe_stripe")
  })

  it("defaults to pp_system_default when the region has no providers", () => {
    expect(resolveCompletionProvider([])).toBe("pp_system_default")
    expect(resolveCompletionProvider(undefined)).toBe("pp_system_default")
  })

  it("honors the PAYU_LINK_COMPLETE_PROVIDER override", () => {
    expect(
      resolveCompletionProvider([{ id: "pp_payu_payu", is_enabled: true }], "pp_custom")
    ).toBe("pp_custom")
  })
})

describe("buildSessionData", () => {
  const ref = { txnid: "918188", mihpayid: "mih_1", mode: "UPI", bank_ref_num: "br_1" }

  it("builds flat PayU authorize data (status+txnid) for a PayU provider", () => {
    expect(buildSessionData("pp_payu_payu", ref)).toEqual({
      payu_status: "success",
      txnid: "918188",
      mihpayid: "mih_1",
      mode: "UPI",
      bank_ref_num: "br_1",
    })
  })

  it("wraps the ref as external_payment for a manual provider", () => {
    expect(buildSessionData("pp_system_default", ref)).toEqual({
      external_payment: ref,
    })
  })

  it("returns undefined for a manual provider with no ref", () => {
    expect(buildSessionData("pp_system_default")).toBeUndefined()
  })
})
