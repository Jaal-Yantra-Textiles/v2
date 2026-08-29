import { resolveShipmentPaymentMode } from "../payment-mode"

/**
 * The rule that decides whether a parcel can be handed to Shiprocket at all.
 *
 * 🔴 The defect these cover: `payment_mode` came from `payment_status` alone,
 * so anything that was not `captured`/`paid` became COD — including on a
 * cross-border lane, where `buildInternationalCreateBody` THROWS on that value.
 * The fallback never produced a COD shipment; it produced no shipment, and
 * creating the fulfilment failed outright.
 */
describe("resolveShipmentPaymentMode", () => {
  describe("international — there is no COD to fall back to", () => {
    /**
     * Every status that is not settled. Each one used to become `cod` and take
     * the whole fulfilment down with it; `awaiting` and `authorized` are the
     * ordinary states of a card that has not been captured yet.
     */
    const UNSETTLED = [
      "awaiting",
      "authorized",
      "partially_captured",
      "not_paid",
      "requires_action",
      undefined,
      null,
      "",
    ]

    it.each(UNSETTLED)(
      "ships PREPAID with payment_status=%p rather than failing to ship",
      (status) => {
        const result = resolveShipmentPaymentMode({
          payment_status: status,
          destination_country_code: "US",
          sub_total: 4500,
        })

        expect(result.payment_mode).toBe("prepaid")
        // Never 0 — an amount of zero is still an amount, and COD is not on
        // offer here at any value.
        expect(result.cod_amount).toBeUndefined()
        expect(result.international).toBe(true)
      }
    )

    it("flags an unsettled international shipment so it is visible, not silent", () => {
      const result = resolveShipmentPaymentMode({
        payment_status: "awaiting",
        destination_country_code: "GB",
        sub_total: 4500,
      })

      expect(result.warn_uncaptured).toBe(true)
    })

    it("does not flag one whose payment has actually settled", () => {
      const result = resolveShipmentPaymentMode({
        payment_status: "captured",
        destination_country_code: "GB",
        sub_total: 4500,
      })

      expect(result.payment_mode).toBe("prepaid")
      expect(result.warn_uncaptured).toBe(false)
    })

    it("is case- and whitespace-insensitive about the country", () => {
      const result = resolveShipmentPaymentMode({
        payment_status: "awaiting",
        destination_country_code: "  us  ",
        sub_total: 100,
      })

      expect(result.international).toBe(true)
      expect(result.payment_mode).toBe("prepaid")
    })
  })

  describe("domestic — COD is a real choice and stays available", () => {
    it("still ships COD for the unsettled domestic order, collecting the subtotal", () => {
      const result = resolveShipmentPaymentMode({
        payment_status: "awaiting",
        destination_country_code: "IN",
        sub_total: 4500,
      })

      expect(result.payment_mode).toBe("cod")
      expect(result.cod_amount).toBe(4500)
      expect(result.international).toBe(false)
      // Domestic COD is the intended flow, so there is nothing to warn about.
      expect(result.warn_uncaptured).toBe(false)
    })

    it.each(["captured", "paid"])(
      "ships prepaid once the money is in (%s)",
      (status) => {
        const result = resolveShipmentPaymentMode({
          payment_status: status,
          destination_country_code: "IN",
          sub_total: 4500,
        })

        expect(result.payment_mode).toBe("prepaid")
        expect(result.cod_amount).toBeUndefined()
      }
    )

    /**
     * 🔑 Must match `deriveShiprocketRateContext`, where an absent country is
     * also domestic. One derivation saying "international" while the other says
     * "domestic" is how a parcel gets quoted on one product and shipped on
     * another.
     */
    it("treats an absent country as domestic, agreeing with the rate context", () => {
      const result = resolveShipmentPaymentMode({
        payment_status: "awaiting",
        destination_country_code: "",
        sub_total: 900,
      })

      expect(result.international).toBe(false)
      expect(result.payment_mode).toBe("cod")
    })
  })
})
