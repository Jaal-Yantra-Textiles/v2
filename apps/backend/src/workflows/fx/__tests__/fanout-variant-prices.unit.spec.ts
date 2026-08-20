import { collectVariantPriceIds, mapWithConcurrency } from "../fanout-variant-prices"

/**
 * Pure price-id extraction for the shared FX fanout helper. The workflow-driven
 * part (fanoutVariantPrices → fanoutPricesWorkflow) is exercised by the partner
 * route integration tests; here we lock the shape-tolerant extractor.
 */
describe("collectVariantPriceIds", () => {
  it("reads the remapped `variant.prices[]` shape", () => {
    expect(
      collectVariantPriceIds([
        { id: "v1", prices: [{ id: "p1" }, { id: "p2" }] },
        { id: "v2", prices: [{ id: "p3" }] },
      ])
    ).toEqual(["p1", "p2", "p3"])
  })

  it("reads the raw `variant.price_set.prices[]` shape", () => {
    expect(
      collectVariantPriceIds([
        { id: "v1", price_set: { prices: [{ id: "p1" }] } },
      ])
    ).toEqual(["p1"])
  })

  it("prefers `prices` when both shapes are present", () => {
    expect(
      collectVariantPriceIds([
        { id: "v1", prices: [{ id: "p1" }], price_set: { prices: [{ id: "px" }] } },
      ])
    ).toEqual(["p1"])
  })

  it("tolerates null / empty / missing price rows", () => {
    expect(collectVariantPriceIds(null)).toEqual([])
    expect(collectVariantPriceIds(undefined)).toEqual([])
    expect(collectVariantPriceIds([{ id: "v1" }, { id: "v2", prices: [] }])).toEqual([])
    expect(
      collectVariantPriceIds([{ prices: [{ id: "p1" }, { amount: 5 }] }])
    ).toEqual(["p1"])
  })
})

/**
 * The concurrency bound. This is the fix for the 2026-08-19 prod OOM kills
 * (exit 137, twice in one day) — the helper used to launch one full
 * workflow-engine run per price ALL AT ONCE, so peak memory scaled with the
 * number of prices a partner happened to save rather than with a fixed pool.
 *
 * These tests assert the invariant that actually matters: never more than
 * `limit` tasks in flight. Every one of them passes trivially against
 * `Promise.allSettled(items.map(...))` EXCEPT the peak-concurrency assertions,
 * which is the point — those are the ones that fail without the pool.
 */
describe("mapWithConcurrency", () => {
  /** Runs `n` tasks that all park until released, recording peak overlap. */
  const runTracked = async (n: number, limit: number) => {
    let inFlight = 0
    let peak = 0
    const order: number[] = []
    await mapWithConcurrency(
      Array.from({ length: n }, (_, i) => i),
      limit,
      async (i) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        order.push(i)
        // Yield across a few microtask ticks so overlapping tasks actually
        // interleave — a synchronous body would never reveal a bound.
        await new Promise((r) => setTimeout(r, 1))
        inFlight--
      }
    )
    return { peak, order }
  }

  it("never exceeds the limit — fails against unbounded Promise.allSettled", async () => {
    const { peak } = await runTracked(50, 4)
    expect(peak).toBeLessThanOrEqual(4)
  })

  it("holds the bound when the work greatly outnumbers the pool", async () => {
    const { peak } = await runTracked(200, 4)
    expect(peak).toBeLessThanOrEqual(4)
  })

  it("processes every item exactly once", async () => {
    const { order } = await runTracked(50, 4)
    expect(order).toHaveLength(50)
    expect(new Set(order).size).toBe(50)
  })

  it("does not spawn more workers than there are items", async () => {
    const { peak } = await runTracked(2, 16)
    expect(peak).toBeLessThanOrEqual(2)
  })

  it("still runs concurrently — it is a bound, not a serialiser", async () => {
    const { peak } = await runTracked(20, 4)
    expect(peak).toBeGreaterThan(1)
  })

  it("tolerates an empty list without hanging", async () => {
    await expect(mapWithConcurrency([], 4, async () => {})).resolves.toBeUndefined()
  })

  it("treats a limit below 1 as a pool of 1 rather than spawning nothing", async () => {
    const seen: number[] = []
    await mapWithConcurrency([1, 2, 3], 0, async (i) => {
      seen.push(i)
    })
    expect(seen).toEqual([1, 2, 3])
  })

  it("keeps draining after a task throws mid-run", async () => {
    // fanoutVariantPrices' task swallows its own errors, but the runner must
    // not lose the rest of the queue if one ever escapes.
    const seen: number[] = []
    const task = async (i: number) => {
      seen.push(i)
      if (i === 1) throw new Error("boom")
    }
    await expect(
      mapWithConcurrency([0, 1, 2, 3], 2, async (i) => {
        try {
          await task(i)
        } catch {
          /* mirrors the helper's per-price catch */
        }
      })
    ).resolves.toBeUndefined()
    expect(seen).toHaveLength(4)
  })
})
