import {
  exceedsOrdered,
  fullyDispatched,
  lineLedger,
  sumDispatchedByLine,
} from "../dispatch-ledger"

/**
 * #2289 — a supplier's Complete is a dispatch, not a receipt. The ledger is
 * the one place "sent" and "counted" are told apart.
 */
describe("dispatch ledger", () => {
  const line = (quantity: number, receipts: number[] = []) => ({
    id: "line_1",
    quantity,
    line_fulfillments: receipts.map((q) => ({ quantity_delta: q })),
  })

  it("dispatched-but-uncounted goods are awaiting count, not received", () => {
    const l = lineLedger(line(50), sumDispatchedByLine([{ inventory_order_line_id: "line_1", quantity: 50 }]))
    expect(l).toEqual({ line_id: "line_1", ordered: 50, dispatched: 50, received: 0, to_dispatch: 0, awaiting_count: 50 })
  })

  it("a short count leaves the gap awaiting count", () => {
    const l = lineLedger(line(50, [47]), sumDispatchedByLine([{ inventory_order_line_id: "line_1", quantity: 50 }]))
    expect(l.received).toBe(47)
    expect(l.awaiting_count).toBe(3)
  })

  it("orders completed before #2289 (receipts, no dispatches) count their receipts as sent", () => {
    const l = lineLedger(line(16, [10, 6]), sumDispatchedByLine([]))
    expect(l.dispatched).toBe(16)
    expect(l.to_dispatch).toBe(0)
    expect(l.awaiting_count).toBe(0)
  })

  it("sums several dispatches on a line and ignores other lines", () => {
    const d = sumDispatchedByLine([
      { inventory_order_line_id: "line_1", quantity: 10 },
      { inventory_order_line_id: "line_1", quantity: "6" },
      { inventory_order_line_id: "line_2", quantity: 99 },
    ])
    expect(lineLedger(line(20), d).dispatched).toBe(16)
  })

  it("refuses sending past what was ordered, within 0.01", () => {
    const l = lineLedger(line(2.5), sumDispatchedByLine([{ inventory_order_line_id: "line_1", quantity: 1.5 }]))
    expect(exceedsOrdered(l, 1.0)).toBe(false)
    expect(exceedsOrdered(l, 1.005)).toBe(false)
    expect(exceedsOrdered(l, 1.02)).toBe(true)
    expect(fullyDispatched(l)).toBe(false)
  })
})
