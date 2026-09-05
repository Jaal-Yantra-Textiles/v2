import {
  clampIdBatchInterval,
  DEFAULT_ID_BATCH_INTERVAL_MS,
  MIN_ID_BATCH_INTERVAL_MS,
  MAX_ID_BATCH_INTERVAL_MS,
  MAX_ID_BATCH_IMAGES,
  buildIdBatchBellMessage,
} from "../id-extraction-batch"

/**
 * The pacing half of #1816.
 *
 * The interval is not a nicety — until #1819 exists it IS the rate limit. A
 * caller who can talk the platform into `interval_ms: 0` has re-created the
 * problem the batch was built to solve, so the clamp is the guard that matters
 * and it is asserted from both ends.
 */
describe("clampIdBatchInterval", () => {
  it("defaults when given nothing", () => {
    expect(clampIdBatchInterval(undefined)).toBe(DEFAULT_ID_BATCH_INTERVAL_MS)
  })

  it.each([
    ["zero", 0],
    ["negative", -5000],
    ["below the floor", MIN_ID_BATCH_INTERVAL_MS - 1],
  ])("raises %s to the floor rather than hammering the provider", (_label, value) => {
    expect(clampIdBatchInterval(value)).toBe(MIN_ID_BATCH_INTERVAL_MS)
  })

  it("caps an absurdly long wait", () => {
    expect(clampIdBatchInterval(MAX_ID_BATCH_INTERVAL_MS + 60_000)).toBe(
      MAX_ID_BATCH_INTERVAL_MS
    )
  })

  it("passes a sane value through untouched", () => {
    expect(clampIdBatchInterval(30_000)).toBe(30_000)
  })

  /**
   * 🔴 `NaN` is the one that bites: `Math.min(Math.max(NaN, lo), hi)` is `NaN`,
   * and a `NaN` interval makes `setTimeout` fire immediately — turning the
   * rate limiter into a tight loop over the vision provider. `Number.isFinite`
   * is what stops it, so it is asserted rather than assumed.
   */
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("treats %s as absent instead of producing a broken timer", (_label, value) => {
    const out = clampIdBatchInterval(value as number)
    expect(Number.isFinite(out)).toBe(true)
    expect(out).toBeGreaterThanOrEqual(MIN_ID_BATCH_INTERVAL_MS)
    expect(out).toBeLessThanOrEqual(MAX_ID_BATCH_INTERVAL_MS)
  })
})

describe("batch bounds", () => {
  it("paces ten photographs well inside a few minutes", () => {
    // The founder's actual ask was ten. If the default ever drifts far enough
    // that ten photos becomes an overnight job, this is the test that says so.
    const tenPhotos = (10 - 1) * DEFAULT_ID_BATCH_INTERVAL_MS
    expect(tenPhotos).toBeLessThanOrEqual(5 * 60 * 1000)
  })

  it("keeps the floor below the default, so the default is actually reachable", () => {
    expect(MIN_ID_BATCH_INTERVAL_MS).toBeLessThan(DEFAULT_ID_BATCH_INTERVAL_MS)
    expect(DEFAULT_ID_BATCH_INTERVAL_MS).toBeLessThan(MAX_ID_BATCH_INTERVAL_MS)
  })

  it("caps a batch below the point where it is really a bulk import", () => {
    expect(MAX_ID_BATCH_IMAGES).toBeGreaterThanOrEqual(10)
    expect(MAX_ID_BATCH_IMAGES).toBeLessThanOrEqual(100)
  })
})

/**
 * The bell message (#1816 follow-up).
 *
 * These exist because the notification they replace said the same sentence
 * regardless of outcome — "Batch <id> has drafts waiting for approval" — and
 * was addressed to nobody, so nothing about it could be noticed in the UI.
 */
describe("buildIdBatchBellMessage", () => {
  it("reports the counts, not a fixed sentence", () => {
    const { title, description } = buildIdBatchBellMessage({
      total: 10,
      readable: 10,
      failed: 0,
      outstanding: 0,
    })
    expect(title).toBe("ID cards read — drafts waiting for you")
    expect(description).toContain("10 of 10 read")
    expect(description).not.toContain("failed")
    expect(description).not.toContain("outstanding")
  })

  it("names the failures when some cards could not be read", () => {
    const { title, description } = buildIdBatchBellMessage({
      total: 10,
      readable: 7,
      failed: 3,
      outstanding: 0,
    })
    expect(title).toBe("ID cards read — drafts waiting for you")
    expect(description).toContain("7 of 10 read")
    expect(description).toContain("3 failed")
  })

  /**
   * The #1742 case: a deploy kills the loop, the batch row still says
   * `running`, and the only field that disagrees is `outstanding`. If the bell
   * cannot say this, the partner is told a truncated batch finished.
   */
  it("says a batch stopped early when work is still outstanding", () => {
    const { title, description } = buildIdBatchBellMessage({
      total: 10,
      readable: 4,
      failed: 0,
      outstanding: 6,
    })
    expect(title).toBe("ID card batch stopped early")
    expect(description).toContain("6 still outstanding")
  })

  it("does not invite a review when nothing was read", () => {
    const { title, description } = buildIdBatchBellMessage({
      total: 5,
      readable: 0,
      failed: 5,
      outstanding: 0,
    })
    expect(title).toBe("ID card batch could not be read")
    expect(description).toContain("Nothing was added")
    expect(description).not.toContain("Review the drafts")
  })
})
