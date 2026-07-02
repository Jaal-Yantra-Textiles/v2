import {
  deriveConnectStatus,
  accountToConnectFields,
  isConnectLive,
  assertSafeUrl,
  isStripeConnectEligible,
} from "../lib/stripe-connect"

describe("stripe-connect lib (Half A)", () => {
  describe("deriveConnectStatus", () => {
    it("is active when charges are enabled", () => {
      expect(
        deriveConnectStatus({ charges_enabled: true, details_submitted: true })
      ).toBe("active")
    })

    it("is active even if payouts are not yet enabled (charges is what matters)", () => {
      expect(
        deriveConnectStatus({
          charges_enabled: true,
          payouts_enabled: false,
          details_submitted: true,
        })
      ).toBe("active")
    })

    it("is restricted when details submitted but charges still disabled", () => {
      expect(
        deriveConnectStatus({ charges_enabled: false, details_submitted: true })
      ).toBe("restricted")
    })

    it("is pending before any details are submitted", () => {
      expect(
        deriveConnectStatus({ charges_enabled: false, details_submitted: false })
      ).toBe("pending")
    })

    it("is pending for an empty account object", () => {
      expect(deriveConnectStatus({})).toBe("pending")
    })
  })

  describe("accountToConnectFields", () => {
    it("maps a fully-onboarded account onto typed columns", () => {
      expect(
        accountToConnectFields({
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        })
      ).toEqual({
        connect_status: "active",
        connect_charges_enabled: true,
        connect_payouts_enabled: true,
        connect_details_submitted: true,
      })
    })

    it("coerces missing flags to false", () => {
      expect(accountToConnectFields({})).toEqual({
        connect_status: "pending",
        connect_charges_enabled: false,
        connect_payouts_enabled: false,
        connect_details_submitted: false,
      })
    })
  })

  describe("isConnectLive (\"Connect wins when active\")", () => {
    it("is live only with both an account id and charges enabled", () => {
      expect(
        isConnectLive({ connect_account_id: "acct_1", connect_charges_enabled: true })
      ).toBe(true)
    })

    it("is not live with an account id but charges disabled (onboarding)", () => {
      expect(
        isConnectLive({ connect_account_id: "acct_1", connect_charges_enabled: false })
      ).toBe(false)
    })

    it("is not live without a connected account", () => {
      expect(
        isConnectLive({ connect_account_id: null, connect_charges_enabled: true })
      ).toBe(false)
    })
  })

  describe("assertSafeUrl", () => {
    it("accepts https and http URLs", () => {
      expect(assertSafeUrl("https://partners.jyt.com/settings", "return_url")).toBe(
        "https://partners.jyt.com/settings"
      )
      expect(assertSafeUrl("http://localhost:5173/x", "return_url")).toBe(
        "http://localhost:5173/x"
      )
    })

    it("rejects non-http protocols (open-redirect / xss guard)", () => {
      expect(() => assertSafeUrl("javascript:alert(1)", "return_url")).toThrow()
      expect(() => assertSafeUrl("ftp://host/x", "return_url")).toThrow()
    })

    it("rejects missing or non-absolute values", () => {
      expect(() => assertSafeUrl(undefined, "return_url")).toThrow()
      expect(() => assertSafeUrl("", "return_url")).toThrow()
      expect(() => assertSafeUrl("/relative/path", "return_url")).toThrow()
    })
  })

  describe("isStripeConnectEligible", () => {
    it("is true for EUR partners", () => {
      expect(isStripeConnectEligible({ currency_code: "eur" })).toBe(true)
      expect(isStripeConnectEligible({ country_code: "DE", currency_code: "EUR" })).toBe(true)
    })

    it("is false for India partners (PayU/INR rail)", () => {
      expect(isStripeConnectEligible({ country_code: "IN", currency_code: "inr" })).toBe(false)
      expect(isStripeConnectEligible({ country_code: "in" })).toBe(false)
      // India can never slip through even if currency were mislabelled EUR.
      expect(isStripeConnectEligible({ country_code: "IN", currency_code: "eur" })).toBe(false)
    })

    it("is false for non-EUR / unknown partners", () => {
      expect(isStripeConnectEligible({ currency_code: "usd" })).toBe(false)
      expect(isStripeConnectEligible({ country_code: "US" })).toBe(false)
      expect(isStripeConnectEligible({})).toBe(false)
      expect(isStripeConnectEligible(null)).toBe(false)
      expect(isStripeConnectEligible(undefined)).toBe(false)
    })
  })
})
