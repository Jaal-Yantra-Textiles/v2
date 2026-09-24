import { selectWorkOrderFees } from "../reverse-work-order-fees-job"

describe("reverse-work-order-fees — selectWorkOrderFees (#2262 A)", () => {
  const fee = (id: string, order_id: string, over: Record<string, unknown> = {}) => ({
    id,
    order_id,
    partner_id: "p1",
    fee_type: "commission",
    status: "accrued",
    fee_amount: 10,
    currency_code: "inr",
    ...over,
  })
  const workOrders = new Set(["order_WORK"])

  it("reverses an accrued commission on a proven work order", () => {
    const { reverse, notWorkOrder } = selectWorkOrderFees([fee("f1", "order_WORK")], workOrders)
    expect(reverse.map((f) => f.id)).toEqual(["f1"])
    expect(notWorkOrder).toEqual([])
  })

  it("leaves a commission on an order that is NOT a proven work order, and reports it", () => {
    const { reverse, notWorkOrder } = selectWorkOrderFees([fee("f2", "order_RETAIL")], workOrders)
    expect(reverse).toEqual([])
    expect(notWorkOrder.map((f) => f.id)).toEqual(["f2"])
  })

  it("never touches a retail_split fee, even on a work order", () => {
    const { reverse, notWorkOrder } = selectWorkOrderFees(
      [fee("f3", "order_WORK", { fee_type: "retail_split" })],
      workOrders
    )
    expect(reverse).toEqual([])
    expect(notWorkOrder).toEqual([])
  })

  it.each(["invoiced", "waived", "reversed"])(
    "never touches a fee already %s",
    (status) => {
      const { reverse } = selectWorkOrderFees([fee("f4", "order_WORK", { status })], workOrders)
      expect(reverse).toEqual([])
    }
  )
})
