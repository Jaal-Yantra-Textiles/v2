import { onboardingProfileUpdateSchema } from "../validators"

describe("onboardingProfileUpdateSchema (#648 slice 1)", () => {
  it("accepts a full valid payload", () => {
    const res = onboardingProfileUpdateSchema.safeParse({
      what_they_sell: "apparel",
      price_range: "premium",
      has_inventory_info: true,
      does_stock: false,
      does_weaving: true,
      person_type: "manufacturer",
      team_size: 12,
      payment_collection: "through_us",
      completed: true,
    })
    expect(res.success).toBe(true)
  })

  it("accepts an empty payload (partial save)", () => {
    expect(onboardingProfileUpdateSchema.safeParse({}).success).toBe(true)
  })

  it("accepts nullable fields set to null", () => {
    const res = onboardingProfileUpdateSchema.safeParse({
      what_they_sell: null,
      team_size: null,
      payment_collection: null,
    })
    expect(res.success).toBe(true)
  })

  it("rejects an out-of-enum what_they_sell value", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({ what_they_sell: "spaceships" })
        .success
    ).toBe(false)
  })

  it("rejects an out-of-enum payment_collection value", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({ payment_collection: "crypto" })
        .success
    ).toBe(false)
  })

  it("rejects a non-integer team_size", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({ team_size: 3.5 }).success
    ).toBe(false)
  })

  it("rejects a negative team_size", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({ team_size: -1 }).success
    ).toBe(false)
  })

  it("rejects unknown fields (strict)", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({ not_real: "x" }).success
    ).toBe(false)
  })

  // #859 S1 / #860 — selling_mode + commission_bps
  it("accepts a valid selling_mode", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({
        selling_mode: "core_channel_listing",
      }).success
    ).toBe(true)
  })

  it("rejects an out-of-enum selling_mode", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({ selling_mode: "franchise" })
        .success
    ).toBe(false)
  })

  it("accepts commission_bps within 0..10000", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({ commission_bps: 1500 }).success
    ).toBe(true)
    expect(
      onboardingProfileUpdateSchema.safeParse({ commission_bps: 0 }).success
    ).toBe(true)
  })

  it("rejects commission_bps above 100% (>10000) or negative", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({ commission_bps: 10001 }).success
    ).toBe(false)
    expect(
      onboardingProfileUpdateSchema.safeParse({ commission_bps: -1 }).success
    ).toBe(false)
  })

  it("rejects a non-integer commission_bps", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({ commission_bps: 12.5 }).success
    ).toBe(false)
  })

  // #859 / #861 — supplier capability (orthogonal to selling_mode)
  it("accepts supplies_to_platform booleans and null", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({ supplies_to_platform: true }).success
    ).toBe(true)
    expect(
      onboardingProfileUpdateSchema.safeParse({ supplies_to_platform: false }).success
    ).toBe(true)
    expect(
      onboardingProfileUpdateSchema.safeParse({ supplies_to_platform: null }).success
    ).toBe(true)
  })

  it("rejects a non-boolean supplies_to_platform", () => {
    expect(
      onboardingProfileUpdateSchema.safeParse({ supplies_to_platform: "yes" }).success
    ).toBe(false)
  })
})
