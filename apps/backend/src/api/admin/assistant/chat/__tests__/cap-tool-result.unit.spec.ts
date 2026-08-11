import { capToolResult } from "../route"

/**
 * #1238 — bound a single tool result so one Data Plumbing sweep can't push the
 * next chat request past the body limit ("Payload too large").
 *
 * The body-parser ceiling was the actual cause (Express's 100kb default applied
 * because the route never set `sizeLimit`); this is the belt to that braces —
 * results are re-sent on every subsequent turn, so an unbounded one is paid for
 * over and over.
 */

const bytes = (v: unknown) => JSON.stringify(v)!.length
const LIMIT = 64 * 1024

const bigChanges = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    entity: "inventory_level",
    id: `iitem_${String(i).padStart(26, "0")}@sloc_${String(i).padStart(26, "0")}`,
    field: `stocked_quantity (log 01KXQNH53${String(i).padStart(17, "0")})`,
    before: 100 + i,
    after: 99 + i,
  }))

describe("capToolResult", () => {
  it("passes a small result through untouched", () => {
    const result = { summary: "Would apply 1 of 1", changes: bigChanges(1) }
    expect(capToolResult(result)).toBe(result)
  })

  it("truncates the largest array when the result is oversized", () => {
    const result = {
      summary: "Would apply 4000 of 4000 committed log(s)",
      dry_run: true,
      changes: bigChanges(4000),
    }
    expect(bytes(result)).toBeGreaterThan(LIMIT)

    const capped = capToolResult(result)
    expect(bytes(capped)).toBeLessThanOrEqual(LIMIT)
    expect(capped.changes.length).toBeLessThan(4000)
    expect(capped.changes.length).toBeGreaterThan(0)
  })

  it("keeps the summary and scalars — the part a human actually reads", () => {
    const capped = capToolResult({
      summary: "Would apply 4000 of 4000 committed log(s) at sloc_brand",
      dry_run: true,
      applied: false,
      job_id: "apply-committed-consumption-to-inventory",
      changes: bigChanges(4000),
    })

    expect(capped.summary).toBe(
      "Would apply 4000 of 4000 committed log(s) at sloc_brand"
    )
    expect(capped.dry_run).toBe(true)
    expect(capped.applied).toBe(false)
    expect(capped.job_id).toBe("apply-committed-consumption-to-inventory")
  })

  it("says it truncated, and by how much, rather than going quiet", () => {
    const capped = capToolResult({
      summary: "big",
      changes: bigChanges(4000),
    })

    expect(capped.truncated.field).toBe("changes")
    expect(capped.truncated.total).toBe(4000)
    expect(capped.truncated.shown).toBe(capped.changes.length)
    expect(capped.truncated.note).toMatch(/truncated/i)
  })

  it("picks the biggest array when several are present", () => {
    const capped = capToolResult({
      summary: "big",
      errors: [{ message: "one" }, { message: "two" }],
      changes: bigChanges(4000),
    })

    expect(capped.truncated.field).toBe("changes")
    expect(capped.errors).toHaveLength(2)
  })

  it("reaches into `data` when the payload is wrapped", () => {
    const capped = capToolResult({
      ok: true,
      data: { summary: "big", changes: bigChanges(4000) },
    })

    expect(bytes(capped)).toBeLessThanOrEqual(LIMIT)
    expect(capped.data.truncated.total).toBe(4000)
    expect(capped.ok).toBe(true)
  })

  it("leaves a large result with no array alone rather than mangling it", () => {
    const result = { summary: "x".repeat(LIMIT + 10) }
    const capped = capToolResult(result)
    expect(capped.summary).toBe(result.summary)
  })

  it("is safe on non-objects", () => {
    expect(capToolResult(null)).toBeNull()
    expect(capToolResult("text")).toBe("text")
    expect(capToolResult(42)).toBe(42)
  })
})
