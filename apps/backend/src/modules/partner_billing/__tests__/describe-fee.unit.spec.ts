import { describeFee, formatFeeRate } from "../describe-fee"

describe("formatFeeRate (#623)", () => {
  it("renders percentage basis points as a percent (2 dp)", () => {
    expect(formatFeeRate("percentage", 200)).toBe("2.00%")
    expect(formatFeeRate("percentage", 250)).toBe("2.50%")
    expect(formatFeeRate("percentage", 0)).toBe("0.00%")
    expect(formatFeeRate("percentage", "175")).toBe("1.75%")
  })

  it("renders a flat fee as an amount + currency", () => {
    expect(formatFeeRate("flat", 50, "inr")).toBe("50.00 INR")
    expect(formatFeeRate("flat", "12.5", "usd")).toBe("12.50 USD")
  })

  it("coerces non-finite rates to 0", () => {
    expect(formatFeeRate("percentage", null)).toBe("0.00%")
    expect(formatFeeRate("percentage", undefined)).toBe("0.00%")
    expect(formatFeeRate("percentage", "nope")).toBe("0.00%")
  })
})

describe("describeFee (#623)", () => {
  it("returns null for nullish / order-less rows", () => {
    expect(describeFee(null)).toBeNull()
    expect(describeFee(undefined)).toBeNull()
    expect(describeFee({})).toBeNull()
    expect(describeFee({ fee_amount: 100 })).toBeNull()
  })

  it("shapes a percentage fee into a display object", () => {
    expect(
      describeFee({
        order_id: "order_1",
        currency_code: "inr",
        fee_basis: "percentage",
        fee_rate: 200,
        fee_amount: "199.99",
        order_total: "9999.50",
        status: "accrued",
      })
    ).toEqual({
      order_id: "order_1",
      status: "accrued",
      fee_basis: "percentage",
      fee_type: "commission",
      rate_label: "2.00%",
      fee_amount: 199.99,
      order_total: 9999.5,
      currency_code: "INR",
      is_collectible: true,
      breakdown: null,
      shipping: null,
      shipping_charges: [],
      shipping_reversals: [],
      net_payout: 9799.51,
    })
  })

  describe("platform shipping + net payout", () => {
    const base = {
      order_id: "o",
      currency_code: "inr",
      fee_rate: 200,
      fee_amount: 100,
      order_total: 1000,
      status: "accrued",
    }

    it("reports no shipping when the partner shipped on their own account", () => {
      const d = describeFee(base)!
      expect(d.shipping).toBeNull()
      expect(d.net_payout).toBe(900)
    })

    it("deducts a recorded platform shipping charge from the payout", () => {
      const d = describeFee({
        ...base,
        shipping_amount: "75.5",
        shipping_currency_code: "inr",
        shipping_carrier: "shiprocket",
      })!
      expect(d.shipping).toEqual({
        amount: 75.5,
        currency_code: "INR",
        carrier: "shiprocket",
        is_foreign_currency: false,
      })
      expect(d.net_payout).toBe(824.5)
    })

    it("keeps a recorded zero rate as a shipping row rather than dropping it", () => {
      // Free shipping is a real carrier outcome and must stay visible; only an
      // ABSENT amount means "didn't use our shipping".
      const d = describeFee({ ...base, shipping_amount: 0 })!
      expect(d.shipping).not.toBeNull()
      expect(d.shipping!.amount).toBe(0)
      expect(d.net_payout).toBe(900)
    })

    it("surfaces but does not subtract a foreign-currency carrier charge", () => {
      // Subtracting it would mean inventing an FX rate; the UI shows it on its
      // own line in its own currency instead.
      const d = describeFee({
        ...base,
        shipping_amount: 12,
        shipping_currency_code: "usd",
        shipping_carrier: "shiprocket",
      })!
      expect(d.shipping!.is_foreign_currency).toBe(true)
      expect(d.shipping!.currency_code).toBe("USD")
      expect(d.net_payout).toBe(900)
    })

    it("does not deduct a waived or reversed commission", () => {
      expect(describeFee({ ...base, status: "waived" })!.net_payout).toBe(1000)
      expect(describeFee({ ...base, status: "reversed" })!.net_payout).toBe(1000)
    })

    it("still deducts shipping when the commission itself was waived", () => {
      // The carrier was paid regardless of whether we waived our cut.
      const d = describeFee({
        ...base,
        status: "waived",
        shipping_amount: 60,
        shipping_currency_code: "inr",
      })!
      expect(d.net_payout).toBe(940)
    })

    it("falls back to the order currency when the carrier currency is absent", () => {
      const d = describeFee({ ...base, shipping_amount: 40 })!
      expect(d.shipping!.currency_code).toBe("INR")
      expect(d.shipping!.is_foreign_currency).toBe(false)
      expect(d.net_payout).toBe(860)
    })
  })

  describe("multi-fulfillment shipping", () => {
    const base = {
      order_id: "o",
      currency_code: "inr",
      fee_rate: 200,
      fee_amount: 100,
      order_total: 1000,
      status: "accrued",
    }
    const line = (over: Record<string, any> = {}) => ({
      fulfillment_id: "ful_1",
      amount: 400,
      currency_code: "INR",
      carrier: "bluedart",
      awb: "AWB1",
      ...over,
    })

    it("deducts EVERY box's freight, not just the last recorded", () => {
      const d = describeFee({
        ...base,
        metadata: {
          shipping_charges: [
            line(),
            line({ fulfillment_id: "ful_2", amount: 250, carrier: "delhivery" }),
          ],
        },
      })!
      expect(d.shipping_charges).toHaveLength(2)
      expect(d.shipping!.amount).toBe(650)
      // Two carriers → no single name is true; the lines carry the detail.
      expect(d.shipping!.carrier).toBeNull()
      expect(d.shipping_charges.map((c) => c.carrier)).toEqual([
        "bluedart",
        "delhivery",
      ])
      // 1000 − 100 commission − 650 freight.
      expect(d.net_payout).toBe(250)
    })

    it("keeps the single-box shape untouched — the case that covers most orders", () => {
      const d = describeFee({
        ...base,
        shipping_amount: 400,
        shipping_currency_code: "INR",
        shipping_carrier: "bluedart",
      })!
      expect(d.shipping).toEqual({
        amount: 400,
        currency_code: "INR",
        carrier: "bluedart",
        is_foreign_currency: false,
      })
      expect(d.shipping_charges).toHaveLength(1)
      // A pre-ledger row can't say which box it was for.
      expect(d.shipping_charges[0].fulfillment_id).toBeNull()
      expect(d.net_payout).toBe(500)
    })

    it("shows a foreign-currency box but never folds it into the deduction", () => {
      const d = describeFee({
        ...base,
        metadata: {
          shipping_charges: [
            line(),
            line({ fulfillment_id: "ful_2", amount: 30, currency_code: "USD" }),
          ],
        },
      })!
      expect(d.shipping_charges[1].is_foreign_currency).toBe(true)
      expect(d.shipping!.amount).toBe(400)
      // Only the INR box is deducted: 1000 − 100 − 400.
      expect(d.net_payout).toBe(500)
    })

    it("attributes each line to its fulfillment and waybill", () => {
      const d = describeFee({
        ...base,
        metadata: {
          shipping_charges: [line(), line({ fulfillment_id: "ful_2", awb: "AWB2" })],
        },
      })!
      expect(d.shipping_charges.map((c) => [c.fulfillment_id, c.awb])).toEqual([
        ["ful_1", "AWB1"],
        ["ful_2", "AWB2"],
      ])
    })

    it("reverses one box and keeps deducting the other", () => {
      const d = describeFee({
        ...base,
        metadata: {
          shipping_charges: [
            line({ fulfillment_id: "ful_2", amount: 250, carrier: "delhivery" }),
          ],
          shipping_reversals: [
            { amount: 400, currency_code: "INR", carrier: "bluedart", awb: "AWB1" },
          ],
        },
      })!
      expect(d.shipping!.amount).toBe(250)
      expect(d.shipping_reversals[0].amount).toBe(400)
      // 1000 − 100 − 250; the reversed box costs nothing.
      expect(d.net_payout).toBe(650)
    })
  })

  describe("reversed platform shipping (#1285 follow-up)", () => {
    const base = {
      order_id: "o",
      currency_code: "inr",
      fee_rate: 200,
      fee_amount: 100,
      order_total: 1000,
      status: "accrued",
    }

    it("is empty for a row that never carried a reversal", () => {
      expect(describeFee(base)!.shipping_reversals).toEqual([])
      expect(describeFee({ ...base, metadata: {} })!.shipping_reversals).toEqual([])
    })

    it("surfaces a reversal WITHOUT deducting it — that is the point", () => {
      const d = describeFee({
        ...base,
        // Cleared by the reversal; the freight is no longer charged.
        shipping_amount: null,
        metadata: {
          shipping_reversals: [
            {
              amount: 400.01,
              currency_code: "INR",
              carrier: "bluedart",
              awb: "77712345678",
              reversed_at: "2026-08-14T06:00:00.000Z",
              reason: "pickup no-show",
            },
          ],
        },
      })!
      expect(d.shipping).toBeNull()
      expect(d.shipping_reversals).toHaveLength(1)
      expect(d.shipping_reversals[0]).toEqual({
        amount: 400.01,
        currency_code: "INR",
        carrier: "bluedart",
        awb: "77712345678",
        reversed_at: "2026-08-14T06:00:00.000Z",
        reason: "pickup no-show",
        // Pre-FX reversal: nothing was converted, so there is no rate to carry.
        fx: null,
      })
      // 1000 − 100 commission, and nothing for the reversed freight.
      expect(d.net_payout).toBe(900)
    })

    it("shows the replacement carrier's charge beside the reversed one", () => {
      const d = describeFee({
        ...base,
        shipping_amount: 250,
        shipping_currency_code: "INR",
        shipping_carrier: "delhivery",
        metadata: {
          shipping_reversals: [
            { amount: 400, currency_code: "INR", carrier: "bluedart" },
          ],
        },
      })!
      expect(d.shipping!.amount).toBe(250)
      expect(d.shipping!.carrier).toBe("delhivery")
      expect(d.shipping_reversals[0].amount).toBe(400)
      // Only the LIVE charge is deducted: 1000 − 100 − 250.
      expect(d.net_payout).toBe(650)
    })

    it("keeps every reversal when a waybill is cancelled more than once", () => {
      const d = describeFee({
        ...base,
        metadata: {
          shipping_reversals: [
            { amount: 400, currency_code: "INR", carrier: "bluedart" },
            { amount: 250, currency_code: "INR", carrier: "delhivery" },
          ],
        },
      })!
      expect(d.shipping_reversals.map((r) => r.carrier)).toEqual([
        "bluedart",
        "delhivery",
      ])
      expect(d.net_payout).toBe(900)
    })

    it("never throws on malformed metadata — this is a reporting payload", () => {
      expect(
        describeFee({ ...base, metadata: { shipping_reversals: "nope" } as any })!
          .shipping_reversals
      ).toEqual([])
      const d = describeFee({
        ...base,
        metadata: { shipping_reversals: [{}, { amount: "oops" }] },
      })!
      expect(d.shipping_reversals).toHaveLength(2)
      expect(d.shipping_reversals[0]).toEqual({
        amount: 0,
        // Falls back to the order currency rather than an empty label.
        currency_code: "INR",
        carrier: null,
        awb: null,
        reversed_at: null,
        reason: null,
        fx: null,
      })
      expect(d.shipping_reversals[1].amount).toBe(0)
    })
  })

  it("defaults basis to percentage and status to accrued", () => {
    const d = describeFee({ order_id: "o", fee_rate: 200 })!
    expect(d.fee_basis).toBe("percentage")
    expect(d.status).toBe("accrued")
    expect(d.currency_code).toBe("")
  })

  it("marks reversed / waived fees as not collectible", () => {
    expect(describeFee({ order_id: "o", status: "reversed" })!.is_collectible).toBe(false)
    expect(describeFee({ order_id: "o", status: "waived" })!.is_collectible).toBe(false)
    expect(describeFee({ order_id: "o", status: "invoiced" })!.is_collectible).toBe(true)
  })

  it("handles a flat fee", () => {
    const d = describeFee({
      order_id: "o",
      fee_basis: "flat",
      fee_rate: 50,
      fee_amount: 50,
      currency_code: "INR",
    })!
    expect(d.rate_label).toBe("50.00 INR")
    expect(d.fee_basis).toBe("flat")
  })
})
