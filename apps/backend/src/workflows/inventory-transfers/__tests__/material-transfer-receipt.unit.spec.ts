/**
 * Material-transfer receipt (#2144), two defects found on the first real use
 * (#2271, 2026-09-26: 4 units Sharlho → Dharamshala):
 *
 *  - an accept-all receipt (no received_quantity) reported shortfall = the
 *    whole quantity, though the stock moved and the row stored the right count;
 *  - the receipt note replaced the creation note, erasing who approved it.
 */
import { transferShortfall } from "../../production-runs/receive-goods-transfer"
import { mergeReceiptNotes, receiptCountedQuantity } from "../material-transfer"

describe("receiptCountedQuantity", () => {
  it("omitted means everything sent arrived, so the shortfall is 0", () => {
    expect(receiptCountedQuantity(2, undefined)).toBe(2)
    expect(transferShortfall(2, receiptCountedQuantity(2, undefined))).toBe(0)
  })

  it("a short count still reports what did not arrive", () => {
    expect(transferShortfall(10, receiptCountedQuantity(10, 7.5))).toBe(2.5)
  })

  it("an explicit 0 (the box came empty) is a full shortfall, not 'all arrived'", () => {
    expect(receiptCountedQuantity(3, 0)).toBe(0)
    expect(transferShortfall(3, receiptCountedQuantity(3, 0))).toBe(3)
  })
})

describe("mergeReceiptNotes", () => {
  it("keeps the creation note and appends the receipt note", () => {
    expect(mergeReceiptNotes("Founder approved the move.", "Counted 2."))
      .toBe("Founder approved the move.\nReceipt: Counted 2.")
  })

  it("uses the receipt note alone when there was no creation note", () => {
    expect(mergeReceiptNotes(null, "Counted 2.")).toBe("Counted 2.")
    expect(mergeReceiptNotes("   ", "Counted 2.")).toBe("Counted 2.")
  })
})
