import { diffContract, diffListMembership } from "../work-order-jobs"

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

describe("work-order-parity — diffListMembership (#2264 S2b)", () => {
  const same = { design: ["order_D"], inventory: ["order_I"], retail_excluded: ["order_D", "order_I"] }

  it("reports nothing when both sources list the same orders", () => {
    expect(diffListMembership(same, { ...same, design: ["order_D"] })).toEqual([])
  })

  it("names an order each way: dropped by work_order, and newly listed", () => {
    const changes = diffListMembership(same, {
      design: [],
      inventory: ["order_I"],
      retail_excluded: ["order_D", "order_I", "order_ORPHAN"],
    })
    expect(changes.map((c) => [c.id, c.field, c.after])).toEqual([
      ["order_D", "list:design", "not listed"],
      ["order_ORPHAN", "list:retail_excluded", "listed"],
    ])
  })
})
