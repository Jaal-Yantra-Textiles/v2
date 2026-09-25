jest.mock("../../../links/partner-order", () => ({ default: { entryPoint: "partner_order" } }))

import {
  isSupersededWorkOrder,
  toWorkOrderFilters,
  toWorkOrderOrder,
  workOrderReadsEnabled,
} from "../read-work-orders"

describe("work-order reads (#2264 S2)", () => {
  afterEach(() => {
    delete process.env.WORK_ORDER_READS
  })

  it("is off unless WORK_ORDER_READS=true", () => {
    expect(workOrderReadsEnabled()).toBe(false)
    process.env.WORK_ORDER_READS = "TRUE"
    expect(workOrderReadsEnabled()).toBe(true)
    process.env.WORK_ORDER_READS = "1"
    expect(workOrderReadsEnabled()).toBe(false)
  })

  it("keeps the universal filters and drops retail-only ones", () => {
    expect(
      toWorkOrderFilters({ status: ["pending"], q: "12", created_at: { $gte: "x" }, region_id: "r", sales_channel_id: "s" })
    ).toEqual({ filters: { status: ["pending"], created_at: { $gte: "x" } }, q: "12" })
  })

  it("sorts only by work_order columns, newest first otherwise", () => {
    expect(toWorkOrderOrder({ display_id: "ASC" })).toEqual({ display_id: "ASC" })
    expect(toWorkOrderOrder({ total: "DESC" })).toEqual({ created_at: "DESC" })
    expect(toWorkOrderOrder(undefined)).toEqual({ created_at: "DESC" })
  })

  describe("isSupersededWorkOrder — the #2030 rule, both sources OR'd", () => {
    it("hides a canceled order a split superseded, by either source", () => {
      expect(isSupersededWorkOrder({ status: "canceled", superseded_by_run_ids: ["r2"] })).toBe(true)
      expect(isSupersededWorkOrder({ status: "canceled", superseded_by_run_ids: null }, ["child"])).toBe(true)
    })

    it("keeps a real cancellation and any live order", () => {
      expect(isSupersededWorkOrder({ status: "canceled", superseded_by_run_ids: null })).toBe(false)
      expect(isSupersededWorkOrder({ status: "pending", superseded_by_run_ids: ["r2"] }, ["c"])).toBe(false)
    })
  })
})
