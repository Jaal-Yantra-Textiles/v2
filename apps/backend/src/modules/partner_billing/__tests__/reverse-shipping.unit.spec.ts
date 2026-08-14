import {
  planShippingReversal,
  readShippingReversals,
} from "../reverse-shipping"

const EVENT = {
  awb: "77712345678",
  fulfillment_id: "ful_1",
  reason: "pickup no-show",
  reversed_by: "ops@jyt.in",
  reversed_at: "2026-08-14T06:00:00.000Z",
}

describe("readShippingReversals (#1285 follow-up)", () => {
  it("returns [] for anything that isn't an array — metadata is free-form jsonb", () => {
    expect(readShippingReversals(null)).toEqual([])
    expect(readShippingReversals(undefined)).toEqual([])
    expect(readShippingReversals({})).toEqual([])
    expect(readShippingReversals({ shipping_reversals: "nope" } as any)).toEqual([])
    expect(readShippingReversals({ shipping_reversals: {} } as any)).toEqual([])
  })
})

describe("planShippingReversal (#1285 follow-up)", () => {
  const fee = {
    id: "pfee_1",
    shipping_amount: 400.01,
    shipping_currency_code: "inr",
    shipping_carrier: "bluedart",
    metadata: null,
  }

  it("clears the live charge and records what was given back", () => {
    const planned = planShippingReversal(fee, EVENT)!
    expect(planned.id).toBe("pfee_1")
    expect(planned.update).toEqual({
      id: "pfee_1",
      shipping_amount: null,
      shipping_currency_code: null,
      shipping_carrier: null,
      metadata: {
        shipping_reversals: [
          {
            amount: 400.01,
            currency_code: "INR",
            carrier: "bluedart",
            awb: "77712345678",
            fulfillment_id: "ful_1",
            reversed_at: "2026-08-14T06:00:00.000Z",
            reason: "pickup no-show",
            reversed_by: "ops@jyt.in",
          },
        ],
      },
    })
  })

  it("appends rather than replaces, and preserves unrelated metadata", () => {
    const planned = planShippingReversal(
      {
        ...fee,
        shipping_amount: 250,
        shipping_carrier: "delhivery",
        metadata: {
          reversed_reason: "keep me",
          shipping_reversals: [{ amount: 400, carrier: "bluedart" }],
        },
      },
      EVENT
    )!
    expect(planned.update.metadata.reversed_reason).toBe("keep me")
    expect(planned.update.metadata.shipping_reversals).toHaveLength(2)
    expect(planned.update.metadata.shipping_reversals[1].amount).toBe(250)
  })

  it("is idempotent — a second cancel can't stack a phantom reversal", () => {
    // What the row looks like after the first reversal ran.
    expect(
      planShippingReversal(
        {
          id: "pfee_1",
          shipping_amount: null,
          shipping_currency_code: null,
          shipping_carrier: null,
          metadata: { shipping_reversals: [{ amount: 400 }] },
        },
        EVENT
      )
    ).toBeNull()
  })

  it("reverses a recorded 0 — free shipping is a real quoted rate", () => {
    const planned = planShippingReversal({ ...fee, shipping_amount: 0 }, EVENT)!
    expect(planned.reversal.amount).toBe(0)
    expect(planned.update.shipping_amount).toBeNull()
  })

  it("no-ops when there is nothing to reverse", () => {
    // Partner shipped on their own account / carrier quoted no rate.
    expect(planShippingReversal({ id: "pfee_1" }, EVENT)).toBeNull()
    expect(
      planShippingReversal({ id: "pfee_1", shipping_amount: undefined }, EVENT)
    ).toBeNull()
    // Retail order — no fee row at all.
    expect(planShippingReversal(null, EVENT)).toBeNull()
    expect(planShippingReversal({ id: "" }, EVENT)).toBeNull()
    // A corrupt amount must not be "reversed" into a NaN line.
    expect(
      planShippingReversal({ id: "pfee_1", shipping_amount: "oops" }, EVENT)
    ).toBeNull()
  })

  it("coerces a bigNumber string amount and normalises the currency", () => {
    const planned = planShippingReversal(
      { ...fee, shipping_amount: "84.50", shipping_currency_code: "usd" },
      EVENT
    )!
    expect(planned.reversal.amount).toBe(84.5)
    expect(planned.reversal.currency_code).toBe("USD")
  })

  it("tolerates an unattributed cancellation", () => {
    const planned = planShippingReversal(fee, {
      reversed_at: "2026-08-14T06:00:00.000Z",
    })!
    expect(planned.reversal.awb).toBeNull()
    expect(planned.reversal.reason).toBeNull()
    expect(planned.reversal.reversed_by).toBeNull()
    expect(planned.reversal.fulfillment_id).toBeNull()
  })
})
