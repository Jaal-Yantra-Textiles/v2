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
})
