import {
  computeParentRollup,
  parentTotalsPatch,
  type RollupChild,
} from "../lib/parent-run-rollup"

const child = (o: Partial<RollupChild> = {}): RollupChild => ({
  id: "c",
  status: "completed",
  quantity: 1,
  produced_quantity: 1,
  completed_at: "2026-08-13T10:00:00.000Z",
  ...o,
})

describe("computeParentRollup", () => {
  it("sums quantity and produced across children", () => {
    const r = computeParentRollup([
      child({ quantity: 2, produced_quantity: 2 }),
      child({ quantity: 1, produced_quantity: 1 }),
    ])
    expect(r.quantity).toBe(3)
    expect(r.produced_stated).toBe(3)
    expect(r.produced_with_fallback).toBe(3)
    expect(r.children_missing_produced).toBe(0)
    expect(r.all_completed).toBe(true)
  })

  /**
   * The production shape this whole change exists for: the child states its
   * output, the parent's is null. Every one of the seven affected parents in
   * prod is a single child that reported a real number.
   */
  it("recovers the output a single child reported", () => {
    const r = computeParentRollup([child({ quantity: 1, produced_quantity: 1 })])
    expect(r.produced_stated).toBe(1)
    expect(parentTotalsPatch(r)).toEqual({ quantity: 1, produced_quantity: 1 })
  })

  it("does not invent output for a child that reported none", () => {
    const r = computeParentRollup([
      child({ quantity: 3, produced_quantity: null }),
    ])
    expect(r.produced_stated).toBe(0)
    expect(r.children_missing_produced).toBe(1)
    // the ORDERED 3 must not become a production figure
    expect(parentTotalsPatch(r)).toEqual({ quantity: 3 })
  })

  it("promotes the ordered quantity ONLY when the fallback is asked for", () => {
    const r = computeParentRollup([
      child({ quantity: 3, produced_quantity: null }),
    ])
    expect(r.produced_with_fallback).toBe(3)
    expect(parentTotalsPatch(r, { allowFallback: true })).toEqual({
      quantity: 3,
      produced_quantity: 3,
    })
  })

  /**
   * The real `prod_run_..46G0KY`: ordered 3 across two children, one of which
   * (completed 2026-07-04) never stated output. The honest rollup is 1, not 3.
   */
  it("mixes stated and unstated children without over-counting", () => {
    const r = computeParentRollup([
      child({ quantity: 2, produced_quantity: null, completed_at: "2026-07-04T00:00:00.000Z" }),
      child({ quantity: 1, produced_quantity: 1, completed_at: "2026-08-13T00:00:00.000Z" }),
    ])
    expect(r.quantity).toBe(3)
    expect(r.produced_stated).toBe(1)
    expect(r.produced_with_fallback).toBe(3)
    expect(r.children_missing_produced).toBe(1)
  })

  it("takes the LATEST child completed_at", () => {
    const r = computeParentRollup([
      child({ completed_at: "2026-07-04T00:00:00.000Z" }),
      child({ completed_at: "2026-08-13T00:00:00.000Z" }),
      child({ completed_at: null }),
    ])
    expect(r.completed_at?.toISOString()).toBe("2026-08-13T00:00:00.000Z")
  })

  it("is not all_completed when any child is open", () => {
    expect(
      computeParentRollup([child(), child({ status: "in_progress" })])
        .all_completed
    ).toBe(false)
  })

  /**
   * A parent with NO children is not a rollup. Treating an empty set as
   * "every child completed" (which `[].every()` does) would let this path
   * complete a real, unfinished job.
   */
  it("is not all_completed for an empty child set", () => {
    expect(computeParentRollup([]).all_completed).toBe(false)
    expect(computeParentRollup(null).all_completed).toBe(false)
  })

  /**
   * `0` produced is a real, different statement from `null`. It must count as
   * STATED (so the child is not in `children_missing_produced`) while still
   * being omitted from the patch, because writing 0 over an existing figure
   * would destroy it.
   */
  it("treats a produced_quantity of 0 as stated, not missing", () => {
    const r = computeParentRollup([child({ quantity: 5, produced_quantity: 0 })])
    expect(r.children_missing_produced).toBe(0)
    expect(r.produced_stated).toBe(0)
    expect(r.produced_with_fallback).toBe(0)
    expect(parentTotalsPatch(r)).toEqual({ quantity: 5 })
  })

  it("handles string numerics off the ORM", () => {
    const r = computeParentRollup([
      child({ quantity: "2" as any, produced_quantity: "2" as any }),
    ])
    expect(r.quantity).toBe(2)
    expect(r.produced_stated).toBe(2)
  })

  it("ignores unparseable values rather than producing NaN", () => {
    const r = computeParentRollup([
      child({ quantity: "abc" as any, produced_quantity: "" as any }),
    ])
    expect(r.quantity).toBe(0)
    expect(r.produced_stated).toBe(0)
    expect(r.children_missing_produced).toBe(1)
  })
})
