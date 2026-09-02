import { listPayableInventoryOrders } from "../payable-inventory-orders"
import { listPartnerClaims } from "../run-claims"

jest.mock("../run-claims", () => ({
  listPartnerClaims: jest.fn(),
}))

/**
 * The real shape of hrhandloom's `inv_order_01K36TE2WB` as read from production
 * on 2026-09-01: ordered 88,885, receipts 25,620 across five of ten lines, and
 * ALREADY CLAIMED at 25,670 by submission `01M13T8NVJ`.
 *
 * 🔑 A fixture tidier than reality certifies the wrong code. The awkward parts
 * are the point: two deltas on one line (10 + 6), a fractional receipt (11.8),
 * and claims that very slightly EXCEED receipts because the payout was computed
 * before the #1613 rounding fix moved 12 to 11.8.
 */
const PARTIAL_ORDER = {
  id: "inv_order_01K36TE2WB",
  status: "Partial",
  total_price: 88885,
  currency_code: "inr",
  orderlines: [
    { id: "l1", quantity: 16, price: 400, material_name: "Double Black Stripes", line_fulfillments: [{ quantity_delta: 10 }, { quantity_delta: 6 }] },
    { id: "l2", quantity: 31, price: 430, material_name: "White & Black & Red", line_fulfillments: [{ quantity_delta: 10 }] },
    { id: "l3", quantity: 22, price: 380, material_name: "Black & Red line", line_fulfillments: [{ quantity_delta: 10.5 }] },
    { id: "l4", quantity: 21, price: 380, material_name: "Single Black Cheque", line_fulfillments: [{ quantity_delta: 21 }] },
    { id: "l5", quantity: 50, price: 250, material_name: "Kala cotton white", line_fulfillments: [{ quantity_delta: 11.8 }] },
    { id: "l6", quantity: 80, price: 380, material_name: "Yellow cheque", line_fulfillments: [] },
  ],
  internal_payments: [],
}

const containerFor = (orders: any[]) => {
  const query = {
    graph: jest.fn(async () => ({ data: [{ id: "partner_1", inventory_orders: orders }] })),
  }
  return {
    resolve: (key: string) =>
      key === "query" || key === "remoteQuery" ? query : ({} as any),
  } as any
}

const claimsOf = (map: Record<string, number>) => {
  ;(listPartnerClaims as jest.Mock).mockResolvedValue({
    inventoryOrders: new Map(
      Object.entries(map).map(([id, total]) => [
        id,
        { claimed_total: total, claims: [] },
      ])
    ),
  })
}

beforeEach(() => jest.clearAllMocks())

describe("listPayableInventoryOrders — receipts already claimed (#1712)", () => {
  /**
   * 🔴 THE DEFECT. `amount` was `min(receipts, ordered − claimed)`, which nets
   * against the ORDERED total but never against what was already billed for
   * those same receipts. On production this offered another 25,620 for goods
   * billed at 25,670, with ~63,215 of headroom left to repeat it.
   */
  it("offers NOTHING when the receipts are already fully claimed", async () => {
    claimsOf({ "inv_order_01K36TE2WB": 25670 })
    const [row] = await listPayableInventoryOrders(
      containerFor([PARTIAL_ORDER]),
      "partner_1"
    )

    expect(row.receipts_total).toBe(25620)
    expect(row.claimed_total).toBe(25670)
    expect(row.amount).toBe(0)
    expect(row.payable).toBe(false)
    // The ceiling has plenty left — it is the CLAIMS that stop this, and the
    // flag must not blame the ceiling.
    expect(row.remaining).toBe(63215)
    expect(row.capped_by_ceiling).toBe(false)
  })

  it("offers only the receipts not yet claimed", async () => {
    claimsOf({ "inv_order_01K36TE2WB": 10000 })
    const [row] = await listPayableInventoryOrders(
      containerFor([PARTIAL_ORDER]),
      "partner_1"
    )
    expect(row.amount).toBe(15620) // 25,620 − 10,000
    expect(row.payable).toBe(true)
  })

  it("offers the full receipts value when nothing is claimed", async () => {
    claimsOf({})
    const [row] = await listPayableInventoryOrders(
      containerFor([PARTIAL_ORDER]),
      "partner_1"
    )
    expect(row.amount).toBe(25620)
    expect(row.payable).toBe(true)
  })

  /**
   * The ordered-total ceiling still binds: receipts can legitimately sit ABOVE
   * the ordered total (#1617) and `assessInventoryOrderClaims` refuses that.
   */
  it("still caps at the ordered-total ceiling, and says so", async () => {
    const OVER = {
      ...PARTIAL_ORDER,
      id: "inv_order_over",
      total_price: 5000,
      orderlines: [
        { id: "x", quantity: 20, price: 400, material_name: "m", line_fulfillments: [{ quantity_delta: 20 }] },
      ],
    }
    claimsOf({})
    const [row] = await listPayableInventoryOrders(containerFor([OVER]), "partner_1")
    expect(row.receipts_total).toBe(8000)
    expect(row.remaining).toBe(5000)
    expect(row.amount).toBe(5000)
    expect(row.capped_by_ceiling).toBe(true)
  })

  it("never offers a negative amount when claims exceed receipts", async () => {
    claimsOf({ "inv_order_01K36TE2WB": 40000 })
    const [row] = await listPayableInventoryOrders(
      containerFor([PARTIAL_ORDER]),
      "partner_1"
    )
    expect(row.amount).toBe(0)
    expect(row.payable).toBe(false)
  })

  /**
   * `recorded_covers_amount` warns that money already moved covers what is
   * being offered (#1710). With `amount` now netted it must follow the NEW
   * amount, not the raw receipts.
   */
  it("keeps recorded_covers_amount aligned with the netted amount", async () => {
    claimsOf({ "inv_order_01K36TE2WB": 20000 })
    const withPayment = {
      ...PARTIAL_ORDER,
      internal_payments: [{ id: "p1", amount: 6000, status: "Completed" }],
    }
    const [row] = await listPayableInventoryOrders(
      containerFor([withPayment]),
      "partner_1"
    )
    expect(row.amount).toBe(5620) // 25,620 − 20,000
    expect(row.recorded_total).toBe(6000)
    expect(row.recorded_covers_amount).toBe(true)
  })
})
