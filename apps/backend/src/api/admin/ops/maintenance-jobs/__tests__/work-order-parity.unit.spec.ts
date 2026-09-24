import { diffContract } from "../work-order-jobs"

describe("work-order-parity — diffContract (#2263)", () => {
  const mirror = {
    id: "order_1",
    display_id: 7,
    status: "pending",
    created_at: "2026-09-01T00:00:00.000Z",
    currency_code: "inr",
    total: 900,
    metadata: { legacy_id: "prod_run_1" },
    items: [{ id: "ordli_1", title: "Shawl", quantity: 3, unit_price: 300, metadata: { production_run_id: "prod_run_1" } }],
    production_runs: [{ id: "prod_run_1" }],
    unified_order_status: { partner_status: "accepted" },
    unified_order_kind: { kind: "per_run" },
  }

  it("is empty when the two read the same", () => {
    expect(diffContract({ ...mirror }, mirror)).toEqual([])
  })

  it("names exactly the fields that differ", () => {
    expect(
      diffContract(
        { ...mirror, status: "canceled", unified_order_status: { partner_status: "cancelled" } },
        mirror
      ).sort()
    ).toEqual(["partner_status", "status"])
  })

  it("catches a line whose quantity drifted", () => {
    const served = { ...mirror, items: [{ ...mirror.items[0], quantity: 4 }] }
    expect(diffContract(served, mirror)).toEqual(["items"])
  })
})
