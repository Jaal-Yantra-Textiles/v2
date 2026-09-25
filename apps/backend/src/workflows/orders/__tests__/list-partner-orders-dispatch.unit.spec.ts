jest.mock("../list-partner-orders", () => ({ listPartnerOrdersWorkflow: jest.fn() }))
jest.mock("../../../lib/work-orders/read-work-orders", () => ({
  listPartnerWorkOrderIds: jest.fn(),
  listWorkOrdersPage: jest.fn(),
  workOrderReadsEnabled: jest.fn(),
}))

import { mergeByOrder } from "../list-partner-orders-dispatch"

/** #2264 — kind=all merges retail (core) and work orders (work_order). */
describe("mergeByOrder", () => {
  const rows = [
    { id: "retail_old", created_at: "2026-09-01T00:00:00Z", display_id: 3 },
    { id: "wo_new", created_at: "2026-09-20T00:00:00Z", display_id: 1 },
    { id: "retail_mid", created_at: "2026-09-10T00:00:00Z", display_id: 2 },
  ]

  it("newest first by default, across both sources", () => {
    expect(mergeByOrder(rows, undefined).map((r) => r.id)).toEqual([
      "wo_new",
      "retail_mid",
      "retail_old",
    ])
  })

  it("honours the requested key and direction", () => {
    expect(mergeByOrder(rows, { display_id: "ASC" }).map((r) => r.id)).toEqual([
      "wo_new",
      "retail_mid",
      "retail_old",
    ])
  })

  it("puts rows missing the key last, and breaks ties by id", () => {
    const out = mergeByOrder(
      [{ id: "b", display_id: 1 }, { id: "a", display_id: 1 }, { id: "z" }],
      { display_id: "DESC" }
    )
    expect(out.map((r) => r.id)).toEqual(["a", "b", "z"])
  })
})
