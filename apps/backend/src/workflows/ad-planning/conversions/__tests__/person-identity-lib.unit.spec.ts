import {
  derivePersonName,
  isUsableEmail,
  splitFullName,
} from "../person-identity-lib"

/**
 * #664 — pure name/email derivation shared by the live order→Person upsert
 * (resolve-person step) and the backfill-order-persons maintenance job. No DB.
 */
describe("person-identity-lib — splitFullName", () => {
  it("splits first token vs remainder", () => {
    expect(splitFullName("Jane Q Public")).toEqual({
      first_name: "Jane",
      last_name: "Q Public",
    })
  })

  it("single token → first only", () => {
    expect(splitFullName("Madonna")).toEqual({ first_name: "Madonna", last_name: "" })
  })

  it("empty / whitespace → empty strings", () => {
    expect(splitFullName("   ")).toEqual({ first_name: "", last_name: "" })
    expect(splitFullName("")).toEqual({ first_name: "", last_name: "" })
  })
})

describe("person-identity-lib — isUsableEmail", () => {
  it("accepts a normal address", () => {
    expect(isUsableEmail("jane@example.com")).toBe(true)
  })

  it("rejects null/empty/no-@/edge-@", () => {
    expect(isUsableEmail(null)).toBe(false)
    expect(isUsableEmail(undefined)).toBe(false)
    expect(isUsableEmail("")).toBe(false)
    expect(isUsableEmail("not-an-email")).toBe(false)
    expect(isUsableEmail("@example.com")).toBe(false)
    expect(isUsableEmail("jane@")).toBe(false)
  })
})

describe("person-identity-lib — derivePersonName", () => {
  it("prefers billing address", () => {
    expect(
      derivePersonName({
        email: "x@y.com",
        billing_address: { first_name: "Bill", last_name: "Ing" },
        shipping_address: { first_name: "Ship", last_name: "Ping" },
        customer: { first_name: "Cust", last_name: "Omer" },
      })
    ).toEqual({ first_name: "Bill", last_name: "Ing" })
  })

  it("falls back to shipping, then customer", () => {
    expect(
      derivePersonName({
        billing_address: null,
        shipping_address: { first_name: "Ship", last_name: "Ping" },
        customer: { first_name: "Cust", last_name: "Omer" },
      })
    ).toEqual({ first_name: "Ship", last_name: "Ping" })

    expect(
      derivePersonName({
        billing_address: { first_name: "", last_name: "" },
        shipping_address: null,
        customer: { first_name: "Cust", last_name: "Omer" },
      })
    ).toEqual({ first_name: "Cust", last_name: "Omer" })
  })

  it("accepts a partial address (first only) before falling through", () => {
    expect(
      derivePersonName({
        billing_address: { first_name: "Solo", last_name: null },
        customer: { first_name: "Cust", last_name: "Omer" },
      })
    ).toEqual({ first_name: "Solo", last_name: "" })
  })

  it("derives a title-cased name from the email local-part when no address/customer", () => {
    expect(
      derivePersonName({ email: "jane.doe@example.com" })
    ).toEqual({ first_name: "Jane", last_name: "Doe" })

    expect(
      derivePersonName({ email: "support_team@example.com" })
    ).toEqual({ first_name: "Support", last_name: "Team" })
  })

  it("returns empty strings when there is nothing to derive from", () => {
    expect(derivePersonName({})).toEqual({ first_name: "", last_name: "" })
    expect(derivePersonName({ email: "garbage" })).toEqual({
      first_name: "",
      last_name: "",
    })
  })
})
