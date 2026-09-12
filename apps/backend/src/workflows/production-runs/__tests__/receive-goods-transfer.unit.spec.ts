import {
  assertReceivableTransfer,
  planTransferMove,
  transferShortfall,
} from "../receive-goods-transfer"

/**
 * #891 S3. Every one of these guards exists because the wrong answer moves
 * real stock — either minting units that were never made, or driving a
 * location negative.
 */
describe("assertReceivableTransfer", () => {
  const ok = { id: "gtrf_1", production_run_id: "run_1", status: "in_transit" }

  it("accepts a live transfer on the right run", () => {
    expect(() => assertReceivableTransfer(ok, "run_1", "gtrf_1")).not.toThrow()
  })

  it("accepts a draft — a hop can be walked over by hand with no carrier", () => {
    expect(() =>
      assertReceivableTransfer({ ...ok, status: "draft" }, "run_1", "gtrf_1")
    ).not.toThrow()
  })

  it("refuses a transfer belonging to another run", () => {
    // Receiving it would move another run's goods.
    expect(() => assertReceivableTransfer(ok, "run_2", "gtrf_1")).toThrow(
      /not found on production run run_2/
    )
  })

  it("refuses a missing transfer", () => {
    expect(() => assertReceivableTransfer(null, "run_1", "gtrf_x")).toThrow(
      /not found/
    )
  })

  it("refuses a second receipt", () => {
    // The whole point: receiving twice moves the same goods twice.
    expect(() =>
      assertReceivableTransfer({ ...ok, status: "delivered" }, "run_1", "gtrf_1")
    ).toThrow(/already been received/)
  })

  it("refuses a cancelled transfer", () => {
    expect(() =>
      assertReceivableTransfer({ ...ok, status: "cancelled" }, "run_1", "gtrf_1")
    ).toThrow(/cancelled/)
  })
})

describe("planTransferMove", () => {
  const hop = { quantity: 3, from_location_id: "sloc_a", to_location_id: "sloc_b" }

  it("moves the sent quantity by default", () => {
    const plan = planTransferMove(hop)
    expect(plan).toMatchObject({ move: true, quantity: 3, to_location_id: "sloc_b" })
  })

  it("moves what was actually counted when that is given", () => {
    expect(planTransferMove(hop, 2)).toMatchObject({ move: true, quantity: 2 })
  })

  it("moves nothing for a customer leg", () => {
    // No destination = the goods left for a customer. The fulfillment path
    // already decrements; doing it here too takes the same garment twice.
    const plan = planTransferMove({ ...hop, to_location_id: null })
    expect(plan.move).toBe(false)
    expect(plan.skip_reason).toBe("customer_leg")
  })

  it("moves nothing when origin and destination are the same location", () => {
    const plan = planTransferMove({ ...hop, to_location_id: "sloc_a" })
    expect(plan.move).toBe(false)
    expect(plan.skip_reason).toBe("same_location")
  })

  it("moves nothing when nothing arrived", () => {
    const plan = planTransferMove(hop, 0)
    expect(plan.move).toBe(false)
    expect(plan.skip_reason).toBe("zero_quantity")
  })

  it("treats a zero received count as zero, not as 'unspecified'", () => {
    // `0` must not fall through to the sent quantity — that would move 3 units
    // on a receipt that said nothing came.
    expect(planTransferMove(hop, 0).quantity).toBe(0)
  })

  it("falls back to the sent quantity for null/undefined/NaN", () => {
    expect(planTransferMove(hop, null).quantity).toBe(3)
    expect(planTransferMove(hop, undefined).quantity).toBe(3)
    expect(planTransferMove(hop, Number.NaN).quantity).toBe(3)
  })

  it("never moves a negative quantity", () => {
    expect(planTransferMove(hop, -2).move).toBe(false)
  })
})

describe("transferShortfall", () => {
  it("reports what did not arrive", () => {
    expect(transferShortfall(5, 3)).toBe(2)
  })

  it("is zero when everything arrived", () => {
    expect(transferShortfall(5, 5)).toBe(0)
  })

  it("never reports a surplus as a negative shortfall", () => {
    // Receiving more than was sent is a data-entry question; "-2 short" reads
    // as a surplus nobody can act on.
    expect(transferShortfall(3, 5)).toBe(0)
  })

  it("handles missing numbers", () => {
    expect(transferShortfall(null, null)).toBe(0)
    expect(transferShortfall(3, null)).toBe(3)
  })
})
