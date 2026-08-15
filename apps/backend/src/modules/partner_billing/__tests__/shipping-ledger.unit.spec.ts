import {
  planShippingChargeUpsert,
  planShippingFxConversion,
  planShippingReversal,
  readShippingCharges,
  readShippingReversals,
  rollUpShippingScalars,
} from "../shipping-ledger"

const AT = "2026-08-14T06:00:00.000Z"
const EVENT = {
  fulfillment_id: "ful_1",
  awb: "77712345678",
  reason: "pickup no-show",
  reversed_by: "ops@jyt.in",
  reversed_at: AT,
}

const charge = (over: Record<string, any> = {}) => ({
  fulfillment_id: "ful_1",
  amount: 400,
  currency_code: "INR",
  carrier: "bluedart",
  awb: "77712345678",
  recorded_at: AT,
  ...over,
})

describe("readShippingReversals", () => {
  it("returns [] for anything that isn't an array — metadata is free-form jsonb", () => {
    expect(readShippingReversals(null)).toEqual([])
    expect(readShippingReversals({})).toEqual([])
    expect(readShippingReversals({ shipping_reversals: "nope" } as any)).toEqual([])
  })
})

describe("readShippingCharges — legacy rows", () => {
  it("synthesises one line from a pre-ledger scalar so the charge doesn't vanish", () => {
    // Every row written before the ledger existed looks like this. If it read as
    // "no charges" the deduction would silently disappear and we'd overpay.
    expect(
      readShippingCharges({
        id: "pfee_1",
        currency_code: "inr",
        shipping_amount: "400.01",
        shipping_currency_code: "inr",
        shipping_carrier: "bluedart",
      })
    ).toEqual([
      {
        fulfillment_id: null,
        amount: 400.01,
        currency_code: "INR",
        carrier: "bluedart",
        awb: null,
        recorded_at: null,
        // A pre-ledger row predates FX: the column holds whatever the carrier
        // quoted, with no rate recorded anywhere to reconstruct.
        fx: null,
      },
    ])
  })

  it("returns [] when there is no charge at all", () => {
    expect(readShippingCharges({ id: "pfee_1", currency_code: "inr" })).toEqual([])
    expect(readShippingCharges(null)).toEqual([])
  })

  it("prefers the ledger over the scalar once it exists", () => {
    const lines = readShippingCharges({
      id: "pfee_1",
      currency_code: "inr",
      shipping_amount: 999,
      metadata: { shipping_charges: [charge()] },
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].amount).toBe(400)
  })

  it("never throws on malformed ledger entries", () => {
    const lines = readShippingCharges({
      id: "pfee_1",
      currency_code: "inr",
      metadata: { shipping_charges: [{}, { amount: "oops" }] },
    })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      fulfillment_id: null,
      amount: 0,
      currency_code: "INR",
      carrier: null,
      awb: null,
      recorded_at: null,
      fx: null,
    })
    expect(lines[1].amount).toBe(0)
  })
})

describe("rollUpShippingScalars", () => {
  it("sums same-currency charges and keeps a single carrier's name", () => {
    expect(
      rollUpShippingScalars(
        [
          charge({ amount: 400 }) as any,
          charge({ fulfillment_id: "ful_2", amount: 250 }) as any,
        ],
        "inr"
      )
    ).toEqual({
      shipping_amount: 650,
      shipping_currency_code: "INR",
      shipping_carrier: "bluedart",
    })
  })

  it("drops the carrier name when two carriers shipped the same order", () => {
    const rolled = rollUpShippingScalars(
      [
        charge({ amount: 400, carrier: "bluedart" }) as any,
        charge({ fulfillment_id: "ful_2", amount: 250, carrier: "delhivery" }) as any,
      ],
      "inr"
    )
    expect(rolled.shipping_amount).toBe(650)
    // No single name is true; the per-line detail lives in the ledger.
    expect(rolled.shipping_carrier).toBeNull()
  })

  it("excludes a foreign-currency charge — no FX rate is invented here", () => {
    expect(
      rollUpShippingScalars(
        [
          charge({ amount: 400 }) as any,
          charge({ fulfillment_id: "ful_2", amount: 30, currency_code: "USD" }) as any,
        ],
        "inr"
      ).shipping_amount
    ).toBe(400)
  })

  it("nulls every scalar when nothing is left", () => {
    expect(rollUpShippingScalars([], "inr")).toEqual({
      shipping_amount: null,
      shipping_currency_code: null,
      shipping_carrier: null,
    })
  })
})

describe("planShippingChargeUpsert", () => {
  const fee = { id: "pfee_1", currency_code: "inr", metadata: null }

  it("records the first box's freight and derives the scalars", () => {
    const update = planShippingChargeUpsert(fee, charge())!
    expect(update.shipping_amount).toBe(400)
    expect(update.shipping_currency_code).toBe("INR")
    expect(update.shipping_carrier).toBe("bluedart")
    expect(update.metadata.shipping_charges).toHaveLength(1)
  })

  it("ACCUMULATES a second box instead of overwriting the first", () => {
    const first = planShippingChargeUpsert(fee, charge())!
    const second = planShippingChargeUpsert(
      { ...fee, metadata: first.metadata, shipping_amount: first.shipping_amount },
      charge({ fulfillment_id: "ful_2", amount: 250, carrier: "delhivery" })
    )!
    expect(second.metadata.shipping_charges).toHaveLength(2)
    expect(second.shipping_amount).toBe(650)
    expect(second.shipping_carrier).toBeNull()
  })

  it("UPSERTS the same box — re-labelling corrects, never double-bills", () => {
    const first = planShippingChargeUpsert(fee, charge())!
    const again = planShippingChargeUpsert(
      { ...fee, metadata: first.metadata },
      charge({ amount: 425 })
    )!
    expect(again.metadata.shipping_charges).toHaveLength(1)
    expect(again.shipping_amount).toBe(425)
  })

  it("absorbs a legacy scalar-only row rather than billing under both schemes", () => {
    const update = planShippingChargeUpsert(
      {
        id: "pfee_1",
        currency_code: "inr",
        shipping_amount: 400,
        shipping_currency_code: "INR",
        shipping_carrier: "bluedart",
      },
      charge({ amount: 425 })
    )!
    expect(update.metadata.shipping_charges).toHaveLength(1)
    expect(update.shipping_amount).toBe(425)
  })

  it("preserves unrelated metadata", () => {
    const update = planShippingChargeUpsert(
      { ...fee, metadata: { reversed_reason: "keep me" } },
      charge()
    )!
    expect(update.metadata.reversed_reason).toBe("keep me")
  })

  it("no-ops without a fee row or a fulfillment id", () => {
    expect(planShippingChargeUpsert(null, charge())).toBeNull()
    expect(
      planShippingChargeUpsert(fee, charge({ fulfillment_id: "" }))
    ).toBeNull()
  })
})

describe("planShippingReversal", () => {
  const twoBoxes = {
    id: "pfee_1",
    currency_code: "inr",
    shipping_amount: 650,
    shipping_currency_code: "INR",
    metadata: {
      shipping_charges: [
        charge({ amount: 400, carrier: "bluedart" }),
        charge({ fulfillment_id: "ful_2", amount: 250, carrier: "delhivery" }),
      ],
    },
  }

  it("reverses ONLY the cancelled box and keeps charging for the one in transit", () => {
    const planned = planShippingReversal(twoBoxes, EVENT)!
    expect(planned.reversal.amount).toBe(400)
    expect(planned.reversal.carrier).toBe("bluedart")
    expect(planned.update.metadata.shipping_charges).toHaveLength(1)
    expect(planned.update.metadata.shipping_charges[0].fulfillment_id).toBe("ful_2")
    // The surviving box's freight is still deducted.
    expect(planned.update.shipping_amount).toBe(250)
    expect(planned.update.shipping_carrier).toBe("delhivery")
  })

  it("clears the scalars once the last box is reversed", () => {
    const planned = planShippingReversal(
      {
        id: "pfee_1",
        currency_code: "inr",
        metadata: { shipping_charges: [charge()] },
      },
      EVENT
    )!
    expect(planned.update.shipping_amount).toBeNull()
    expect(planned.update.shipping_currency_code).toBeNull()
    expect(planned.update.shipping_carrier).toBeNull()
    expect(planned.update.metadata.shipping_reversals).toHaveLength(1)
  })

  it("reverses a legacy scalar-only charge — it predates attribution", () => {
    const planned = planShippingReversal(
      {
        id: "pfee_1",
        currency_code: "inr",
        shipping_amount: 400.01,
        shipping_currency_code: "INR",
        shipping_carrier: "bluedart",
      },
      EVENT
    )!
    expect(planned.reversal.amount).toBe(400.01)
    expect(planned.reversal.fulfillment_id).toBe("ful_1")
    expect(planned.update.shipping_amount).toBeNull()
  })

  it("refuses to guess when several attributed lines exist and none match", () => {
    // Reversing the wrong box's freight is worse than reversing none.
    expect(
      planShippingReversal(twoBoxes, { ...EVENT, fulfillment_id: "ful_9" })
    ).toBeNull()
    expect(
      planShippingReversal(twoBoxes, { reversed_at: AT })
    ).toBeNull()
  })

  it("is idempotent — a second cancel can't stack a phantom reversal", () => {
    const first = planShippingReversal(twoBoxes, EVENT)!
    expect(
      planShippingReversal(
        { ...twoBoxes, metadata: first.update.metadata, shipping_amount: 250 },
        EVENT
      )
    ).toBeNull()
  })

  it("appends reversals rather than replacing them", () => {
    const first = planShippingReversal(twoBoxes, EVENT)!
    const second = planShippingReversal(
      { ...twoBoxes, metadata: first.update.metadata },
      { ...EVENT, fulfillment_id: "ful_2" }
    )!
    expect(second.update.metadata.shipping_reversals).toHaveLength(2)
    expect(second.update.metadata.shipping_reversals[1].amount).toBe(250)
    expect(second.update.shipping_amount).toBeNull()
  })

  it("reverses a recorded 0 — free shipping is a real quoted rate", () => {
    const planned = planShippingReversal(
      {
        id: "pfee_1",
        currency_code: "inr",
        metadata: { shipping_charges: [charge({ amount: 0 })] },
      },
      EVENT
    )!
    expect(planned.reversal.amount).toBe(0)
    expect(planned.update.shipping_amount).toBeNull()
  })

  it("no-ops when there is nothing to reverse", () => {
    expect(planShippingReversal({ id: "pfee_1", currency_code: "inr" }, EVENT)).toBeNull()
    expect(planShippingReversal(null, EVENT)).toBeNull()
    expect(planShippingReversal({ id: "" }, EVENT)).toBeNull()
  })

  it("falls back to the ledger's AWB when the event doesn't carry one", () => {
    const planned = planShippingReversal(
      {
        id: "pfee_1",
        currency_code: "inr",
        metadata: { shipping_charges: [charge({ awb: "LEDGER1" })] },
      },
      { fulfillment_id: "ful_1", reversed_at: AT }
    )!
    expect(planned.reversal.awb).toBe("LEDGER1")
    expect(planned.reversal.reason).toBeNull()
  })
})

describe("planShippingFxConversion (#1305)", () => {
  const AT_FX = "2026-08-15T07:00:00.000Z"
  const convert = (over: Record<string, any> = {}) =>
    planShippingFxConversion({
      amount: 11767,
      currency_code: "INR",
      orderCurrency: "usd",
      rate: 0.01048,
      source: "fx_rates",
      convertedAt: AT_FX,
      ...over,
    })

  it("converts into the order currency and keeps the original for the invoice", () => {
    // Order 79: a DTDC counter booking billed in INR against a USD order.
    expect(convert()).toEqual({
      amount: 123.32,
      currency_code: "USD",
      fx: {
        original_amount: 11767,
        original_currency_code: "INR",
        fx_rate: 0.01048,
        fx_source: "fx_rates",
        converted_at: AT_FX,
      },
    })
  })

  it("rounds to the minor unit — a payout must match an invoice", () => {
    // Left at full precision this is 123.31816, and no statement ever agrees.
    expect(convert()!.amount).toBe(123.32)
  })

  it("returns null for a same-currency charge rather than stamping rate 1", () => {
    // There is nothing to convert; an fx record would claim a conversion that
    // never happened and invite someone to 'correct' the rate later.
    expect(convert({ currency_code: "USD", orderCurrency: "usd" })).toBeNull()
  })

  it("REFUSES a rate that is missing, zero, negative or not finite", () => {
    // Each returns null = "record it unconverted", which is the pre-FX
    // behaviour: shown in its own currency, never deducted. A bad rate must
    // never produce a wrong deduction.
    for (const rate of [null, undefined, 0, -1, NaN, Infinity]) {
      expect(convert({ rate })).toBeNull()
    }
  })

  it("returns null when either currency is missing", () => {
    expect(convert({ orderCurrency: null })).toBeNull()
    expect(convert({ currency_code: "" })).toBeNull()
  })

  it("marks an operator-supplied rate as such — only it matches a statement", () => {
    const r = convert({ rate: 0.0112, source: "operator" })!
    expect(r.fx.fx_source).toBe("operator")
    expect(r.amount).toBe(131.79)
  })
})

describe("the FX ledger round trip (#1305)", () => {
  const AT_FX = "2026-08-15T07:00:00.000Z"
  const converted = planShippingFxConversion({
    amount: 11767,
    currency_code: "INR",
    orderCurrency: "usd",
    rate: 0.01048,
    source: "fx_rates",
    convertedAt: AT_FX,
  })!

  // Order 79 exactly: a legacy scalar-only row holding the ABANDONED
  // Shiprocket charge, on a USD order.
  const legacyRow = {
    id: "pfee_79",
    currency_code: "usd",
    shipping_amount: 6944,
    shipping_currency_code: "INR",
    shipping_carrier: "shiprocket",
    metadata: { kind: "retail" },
  }

  it("a converted charge becomes DEDUCTIBLE — the whole point of #1305", () => {
    const update = planShippingChargeUpsert(legacyRow, {
      fulfillment_id: "ful_79",
      amount: converted.amount,
      currency_code: converted.currency_code,
      carrier: "dtdc",
      awb: "N40878729",
      recorded_at: AT_FX,
      fx: converted.fx,
    })!
    // Before: an INR charge on a USD order rolled up to null and never reached
    // the payout. After: it is USD, so it does.
    expect(update.shipping_amount).toBe(123.32)
    expect(update.shipping_currency_code).toBe("USD")
    expect(update.shipping_carrier).toBe("dtdc")
  })

  it("REPLACES the abandoned carrier's charge instead of stacking on it", () => {
    // The legacy line is claimed, not appended to — otherwise order 79 would be
    // billed for both the cancelled Shiprocket booking and the DTDC one.
    const update = planShippingChargeUpsert(legacyRow, {
      fulfillment_id: "ful_79",
      amount: converted.amount,
      currency_code: converted.currency_code,
      carrier: "dtdc",
      awb: "N40878729",
      recorded_at: AT_FX,
      fx: converted.fx,
    })!
    expect(update.metadata.shipping_charges).toHaveLength(1)
    expect(update.metadata.shipping_charges[0].carrier).toBe("dtdc")
    expect(update.metadata.shipping_charges[0].fx.original_amount).toBe(11767)
  })

  it("survives the read back — the rate is not lost in the jsonb", () => {
    const update = planShippingChargeUpsert(legacyRow, {
      fulfillment_id: "ful_79",
      amount: converted.amount,
      currency_code: converted.currency_code,
      carrier: "dtdc",
      awb: "N40878729",
      recorded_at: AT_FX,
      fx: converted.fx,
    })!
    const [line] = readShippingCharges({ ...legacyRow, ...update } as any)
    expect(line.fx).toEqual(converted.fx)
  })

  it("drops a PARTIAL fx record rather than patching it with defaults", () => {
    // A rate of 0 or a missing original would misstate what a partner was
    // charged. Absent fx is already a correct state; a wrong rate is not.
    const [line] = readShippingCharges({
      id: "pfee_1",
      currency_code: "usd",
      metadata: {
        shipping_charges: [
          {
            fulfillment_id: "ful_1",
            amount: 100,
            currency_code: "USD",
            fx: { original_amount: 9000, fx_rate: 0 },
          },
        ],
      },
    })
    expect(line.fx).toBeNull()
    expect(line.amount).toBe(100)
  })

  it("carries the rate onto the reversal so a credit note can be matched", () => {
    const row = {
      id: "pfee_79",
      currency_code: "usd",
      metadata: {
        shipping_charges: [
          {
            fulfillment_id: "ful_79",
            amount: converted.amount,
            currency_code: "USD",
            carrier: "dtdc",
            awb: "N40878729",
            recorded_at: AT_FX,
            fx: converted.fx,
          },
        ],
      },
    }
    const planned = planShippingReversal(row, {
      fulfillment_id: "ful_79",
      awb: "N40878729",
      reason: "returned to origin",
      reversed_at: AT_FX,
    })!
    // The payout gave back USD 123.32, but DTDC will credit INR 11,767.
    expect(planned.reversal.amount).toBe(123.32)
    expect(planned.reversal.fx!.original_amount).toBe(11767)
    expect(planned.update.shipping_amount).toBeNull()
  })
})
