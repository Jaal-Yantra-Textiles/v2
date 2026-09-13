import { fetchChildRunIdsByParent, fetchChildRunIds } from "../run-children"

/**
 * #2029 item 1 — the typed pointer: which runs carry a split parent's work.
 *
 * The blob these replace (`order.metadata.superseded_by_run_ids`) decided
 * whether a parent run was offered for payment beside its own child, which is
 * how Sharlho drew three ₹1,200 payouts for two garments (#2026). So the
 * failure that matters here is not "throws" — it is "returns an empty map and
 * looks like a run that was never split".
 */
describe("fetchChildRunIdsByParent (#2029 item 1)", () => {
  const container = (
    children: any[],
    opts: { throws?: boolean; capture?: any[] } = {}
  ): any => ({
    resolve: (key: string) => {
      if (key === "production_runs") {
        return {
          listProductionRuns: async (filters: any, config: any) => {
            if (opts.throws) throw new Error("db hiccup")
            opts.capture?.push({ filters, config })
            return children
          },
        }
      }
      return { warn: () => {} }
    },
  })

  it("buckets children under their parent", async () => {
    const map = await fetchChildRunIdsByParent(
      container([
        { id: "c1", parent_run_id: "p1" },
        { id: "c2", parent_run_id: "p1" },
        { id: "c3", parent_run_id: "p2" },
      ]),
      ["p1", "p2"]
    )
    expect(map.get("p1")).toEqual(["c1", "c2"])
    expect(map.get("p2")).toEqual(["c3"])
  })

  /**
   * 🔴 The read must be unbounded. A parent split five ways whose query returns
   * three is not a smaller answer but a WRONG one — and the repo's own batched
   * children read (`api/admin/production-runs/route.ts:346`) takes
   * `parents.length` rows, which under-fetches exactly this shape.
   */
  it("asks for EVERY child, not a page of them", async () => {
    const capture: any[] = []
    await fetchChildRunIdsByParent(container([], { capture }), ["p1"])
    expect(capture[0].config.take).toBeNull()
    expect(capture[0].filters).toEqual({ parent_run_id: ["p1"] })
  })

  it("de-duplicates and drops blank parent ids before querying", async () => {
    const capture: any[] = []
    await fetchChildRunIdsByParent(container([], { capture }), [
      "p1",
      "p1",
      "",
      null as any,
    ])
    expect(capture[0].filters.parent_run_id).toEqual(["p1"])
  })

  it("does not query at all when given no parents", async () => {
    const capture: any[] = []
    const map = await fetchChildRunIdsByParent(container([], { capture }), [])
    expect(map.size).toBe(0)
    expect(capture).toHaveLength(0)
  })

  /**
   * Degrades to empty rather than throwing — every caller falls back to the
   * blob, which is the behaviour they had before this function existed. A read
   * that is only ever an optimisation must not take a payables screen down.
   */
  it("returns an empty map on a read failure instead of throwing", async () => {
    const map = await fetchChildRunIdsByParent(
      container([], { throws: true }),
      ["p1"]
    )
    expect(map.size).toBe(0)
  })

  it("ignores rows missing either id", async () => {
    const map = await fetchChildRunIdsByParent(
      container([
        { id: "c1", parent_run_id: null },
        { id: null, parent_run_id: "p1" },
        { id: "c2", parent_run_id: "p1" },
      ]),
      ["p1"]
    )
    expect(map.get("p1")).toEqual(["c2"])
  })

  it("fetchChildRunIds returns [] for a parent with no children", async () => {
    expect(
      await fetchChildRunIds(container([{ id: "c1", parent_run_id: "other" }]), "p1")
    ).toEqual([])
  })
})
