/**
 * #2306 — telling an existing run to wait on other runs.
 *
 * Every refusal here is a wait that would otherwise stall a run FOREVER while
 * reading exactly like a healthy one: approved, idle, "waiting on X".
 */
import { checkRunDependencyAttach } from "../lib/attach-run-dependencies"

/** A tiny board: id → run. `readRuns` returns the ones that exist. */
const board = (runs: Record<string, any>) => {
  const reads: string[][] = []
  const readRuns = async (ids: string[]) => {
    reads.push(ids)
    return ids.filter((i) => runs[i]).map((i) => ({ id: i, ...runs[i] }))
  }
  return { readRuns, reads }
}

describe("checkRunDependencyAttach", () => {
  it("accepts a real, live upstream run — embroidery before stitching", async () => {
    const { readRuns } = board({ embroider: { status: "sent_to_partner" } })

    const out = await checkRunDependencyAttach("stitch", ["embroider"], readRuns)

    expect(out).toEqual({ ok: true, ids: ["embroider"] })
  })

  it("null and [] both clear", async () => {
    const { readRuns, reads } = board({})
    expect(await checkRunDependencyAttach("stitch", null, readRuns)).toEqual({ ok: true, ids: [] })
    expect(await checkRunDependencyAttach("stitch", [], readRuns)).toEqual({ ok: true, ids: [] })
    expect(reads).toEqual([]) // nothing to read
  })

  it("trims, drops blanks and de-duplicates", async () => {
    const { readRuns } = board({ a: { status: "approved" } })
    const out = await checkRunDependencyAttach("stitch", [" a ", "", "a"], readRuns)
    expect(out).toEqual({ ok: true, ids: ["a"] })
  })

  it("refuses a non-array", async () => {
    const { readRuns } = board({})
    const out = await checkRunDependencyAttach("stitch", "embroider", readRuns)
    expect(out.ok).toBe(false)
  })

  it("refuses a run waiting on itself", async () => {
    const { readRuns } = board({ stitch: { status: "approved" } })
    const out = await checkRunDependencyAttach("stitch", ["stitch"], readRuns)
    expect(out).toMatchObject({ ok: false, message: expect.stringContaining("itself") })
  })

  it("refuses an id that is not a run, naming it", async () => {
    const { readRuns } = board({ embroider: { status: "approved" } })
    const out = await checkRunDependencyAttach("stitch", ["embroider", "prod_run_typo"], readRuns)
    expect(out).toMatchObject({ ok: false, message: expect.stringContaining("prod_run_typo") })
  })

  it("refuses a cancelled upstream — it can never complete", async () => {
    const { readRuns } = board({ embroider: { status: "cancelled" } })
    const out = await checkRunDependencyAttach("stitch", ["embroider"], readRuns)
    expect(out).toMatchObject({ ok: false, message: expect.stringContaining("cancelled") })
  })

  it("refuses a direct loop: the upstream already waits on this run", async () => {
    const { readRuns } = board({
      embroider: { status: "approved", depends_on_run_ids: ["stitch"] },
    })
    const out = await checkRunDependencyAttach("stitch", ["embroider"], readRuns)
    expect(out).toMatchObject({ ok: false, message: expect.stringContaining("loop") })
  })

  it("refuses an indirect loop through other runs", async () => {
    const { readRuns } = board({
      a: { status: "approved", depends_on_run_ids: ["b"] },
      b: { status: "approved", depends_on_run_ids: ["c"] },
      c: { status: "approved", depends_on_run_ids: ["stitch"] },
    })
    const out = await checkRunDependencyAttach("stitch", ["a"], readRuns)
    expect(out.ok).toBe(false)
  })

  it("accepts a long chain with no loop, and stops walking at its end", async () => {
    const { readRuns, reads } = board({
      a: { status: "completed", depends_on_run_ids: ["b"] },
      b: { status: "completed", depends_on_run_ids: [] },
    })
    const out = await checkRunDependencyAttach("stitch", ["a"], readRuns)
    expect(out).toEqual({ ok: true, ids: ["a"] })
    expect(reads).toEqual([["a"], ["b"]])
  })
})
