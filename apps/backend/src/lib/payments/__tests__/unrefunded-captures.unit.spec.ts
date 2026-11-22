import { findUnrefundedCaptures } from "../unrefunded-captures"

describe("findUnrefundedCaptures (#2580)", () => {
  it("flags order #158: ₹1.05 captured on PayU, no refund row", () => {
    expect(
      findUnrefundedCaptures([
        {
          id: "pay_01M811VXR5PGKYENGEJD68TDYT",
          provider_id: "pp_payu_payu",
          currency_code: "inr",
          captures: [{ amount: 1.05 }],
          refunds: [],
        },
      ])
    ).toEqual([
      expect.objectContaining({ payment_id: "pay_01M811VXR5PGKYENGEJD68TDYT", outstanding: 1.05 }),
    ])
  })

  it("is quiet when the refund was recorded", () => {
    expect(
      findUnrefundedCaptures([{ id: "p", captures: [{ amount: 1.05 }], refunds: [{ amount: 1.05 }] }])
    ).toEqual([])
  })

  it("reports only what is still held after a partial refund", () => {
    const [r] = findUnrefundedCaptures([
      { id: "p", captures: [{ amount: 100 }], refunds: [{ amount: 40.1 }] },
    ])
    expect(r.outstanding).toBe(59.9)
  })

  it("ignores uncaptured payments (an authorisation is cancelled, not refunded)", () => {
    expect(findUnrefundedCaptures([{ id: "p", captures: [], refunds: [] }])).toEqual([])
  })
})
