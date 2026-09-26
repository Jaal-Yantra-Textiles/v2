import {
  fetchRunSupersessions,
  readSupersession,
} from "../run-supersession"

describe("readSupersession (#2026)", () => {
  it("flags the real Sharlho parent: canceled mirror carrying superseded_by_run_ids", () => {
    const v = readSupersession({
      id: "order_01M25MSMWD5YRDM4BMXESZJTEM",
      status: "canceled",
      metadata: {
        note: "Small size run, materials and rates copied from prod_run_01M09V91A1VDN0ABSXMTBXNW4M",
        superseded_by_run_ids: ["prod_run_01M25MT34Y8X8ASZMX3X2X9KY7"],
      },
    })
    expect(v).toEqual({
      reason: "superseded_run",
      superseded_by_run_ids: ["prod_run_01M25MT34Y8X8ASZMX3X2X9KY7"],
      mirror_order_id: "order_01M25MSMWD5YRDM4BMXESZJTEM",
    })
  })

  it("flags a canceled mirror with no supersession key as a bare cancellation", () => {
    const v = readSupersession({ id: "order_1", status: "canceled", metadata: {} })
    expect(v?.reason).toBe("canceled_mirror_order")
    expect(v?.superseded_by_run_ids).toEqual([])
  })

  it("leaves a live mirror order alone — that run still bills", () => {
    expect(
      readSupersession({ id: "order_2", status: "completed", metadata: {} })
    ).toBeUndefined()
    expect(
      readSupersession({ id: "order_3", status: "pending", metadata: null })
    ).toBeUndefined()
  })

  it("does NOT act on a live order that merely carries superseded_by_run_ids", () => {
    // The key is written in the same call that cancels. A non-canceled order
    // holding it is a half-applied write — bill it and let a human see both.
    expect(
      readSupersession({
        id: "order_4",
        status: "completed",
        metadata: { superseded_by_run_ids: ["prod_run_x"] },
      })
    ).toBeUndefined()
  })

  it("treats a MISSING mirror order as no evidence, not as superseded", () => {
    // Absence in our instrument is not absence in the world.
    expect(readSupersession(null)).toBeUndefined()
    expect(readSupersession(undefined)).toBeUndefined()
  })

  it("#2306 S3: a SPLIT run with no mirror order is superseded by its stages", () => {
    // A partnerless run gets no work order until it has a partner, so a parent
    // split after an admin assigned it has nothing to cancel — it must not bill
    // beside its own stages.
    expect(readSupersession(null, ["prod_run_stage_a", "prod_run_stage_b"])).toEqual({
      reason: "superseded_run",
      superseded_by_run_ids: ["prod_run_stage_a", "prod_run_stage_b"],
      mirror_order_id: null,
    })
    // No stages and no order is still "no evidence": it bills.
    expect(readSupersession(null, [])).toBeUndefined()
  })

  it("tolerates a non-array superseded_by_run_ids without excluding on a guess", () => {
    const v = readSupersession({
      id: "order_5",
      status: "canceled",
      metadata: { superseded_by_run_ids: "prod_run_x" },
    })
    // Still excluded (it IS canceled), but the malformed value is not invented
    // into a run list the reader would then go looking for.
    expect(v?.reason).toBe("canceled_mirror_order")
    expect(v?.superseded_by_run_ids).toEqual([])
  })

  it("matches status case-insensitively", () => {
    expect(readSupersession({ id: "o", status: "Canceled", metadata: {} })?.reason).toBe(
      "canceled_mirror_order"
    )
  })

  /**
   * #2029 item 1 — the POINTER moves to the typed `parent_run_id` children;
   * the DECISION still keys on the typed `order.status`, exactly as before.
   */
  it("prefers the typed children over the blob", () => {
    const v = readSupersession(
      { id: "o", status: "canceled", metadata: { superseded_by_run_ids: ["stale_run"] } },
      ["typed_child"]
    )
    expect(v?.superseded_by_run_ids).toEqual(["typed_child"])
    expect(v?.reason).toBe("superseded_run")
  })

  it("falls back to the blob for a row written before the typed read existed", () => {
    const v = readSupersession(
      { id: "o", status: "canceled", metadata: { superseded_by_run_ids: ["legacy_child"] } },
      []
    )
    expect(v?.superseded_by_run_ids).toEqual(["legacy_child"])
    expect(v?.reason).toBe("superseded_run")
  })

  /**
   * 🔴 The inversion this guard exists to prevent. An empty typed read is
   * indistinguishable from "I could not read the children", so it must never
   * overrule a blob that names them — doing so would downgrade a superseded
   * parent to a bare cancellation and lose the pointer to the runs that carry
   * the work.
   */
  it("an empty typed read does NOT downgrade a blob that names the children", () => {
    const v = readSupersession(
      { id: "o", status: "canceled", metadata: { superseded_by_run_ids: ["child"] } },
      undefined
    )
    expect(v?.reason).toBe("superseded_run")
    expect(v?.superseded_by_run_ids).toEqual(["child"])
  })

  it("typed children do NOT make a LIVE order superseded", () => {
    expect(
      readSupersession({ id: "o", status: "completed", metadata: {} }, ["child"])
    ).toBeUndefined()
  })
})

describe("fetchRunSupersessions (#2026)", () => {
  const container = (rows: any[], throws = false, orders: any[] = []): any => ({
    resolve: () => ({
      graph: async ({ entity, fields, filters }: any) => {
        if (throws) throw new Error("link read hiccup")
        if (entity === "order") {
          // The backref fallback: a second lookup by unified_order_id.
          return { data: orders.filter((o) => filters.id.includes(o.id)) }
        }
        // Guard the exact field set — reading `order_id` here instead of the
        // `order` LINK would silently read the COMMISSIONING order.
        expect(fields).toContain("order.status")
        expect(fields).toContain("order.metadata")
        expect(fields).toContain("metadata")
        expect(fields).not.toContain("order_id")
        expect(filters.id.length).toBeGreaterThan(0)
        return { data: rows }
      },
    }),
  })

  it("keys verdicts by run id and omits runs that still bill", async () => {
    const map = await fetchRunSupersessions(
      container([
        { id: "run_parent", order: { id: "o1", status: "canceled", metadata: { superseded_by_run_ids: ["run_child"] } } },
        { id: "run_child", order: { id: "o2", status: "completed", metadata: {} } },
        { id: "run_unlinked", order: null },
      ]),
      ["run_parent", "run_child", "run_unlinked"]
    )
    expect([...map.keys()]).toEqual(["run_parent"])
    expect(map.get("run_parent")!.superseded_by_run_ids).toEqual(["run_child"])
  })

  it("returns an empty map without querying when given no runs", async () => {
    const map = await fetchRunSupersessions(
      { resolve: () => { throw new Error("must not resolve") } } as any,
      []
    )
    expect(map.size).toBe(0)
  })

  it("degrades to empty on a query failure rather than taking payables down", async () => {
    const map = await fetchRunSupersessions(container([], true), ["run_a"])
    expect(map.size).toBe(0)
  })
  /**
   * #2029 item 5 — the backref is no longer followed.
   *
   * This test previously asserted the opposite, and the change is deliberate:
   * the backfill it hedged against is now a registered maintenance job, and a
   * preview run against prod on 2026-09-14 found 0 rows that need the backref.
   */
  it("does NOT follow metadata.unified_order_id — the link is the only pointer", async () => {
    const map = await fetchRunSupersessions(
      container(
        [{ id: "run_unlinked", order: null, metadata: { unified_order_id: "order_legacy" } }],
        false,
        [
          {
            id: "order_legacy",
            status: "canceled",
            metadata: { superseded_by_run_ids: ["run_child"] },
          },
        ]
      ),
      ["run_unlinked"]
    )
    expect(map.size).toBe(0)
  })

  /**
   * 🔴 And it says so out loud. Such a run BILLS — this module bills rather
   * than guessing — so its absence from the supersession map is exactly the
   * #2026 overpayment shape and must never be silent.
   */
  it("WARNS about a run that carries a backref but no link", async () => {
    const warn = jest.fn()
    const c: any = {
      resolve: (key: string) => {
        if (key === "logger") return { warn }
        // The children lookup is a real collaborator here; without it, its own
        // degrade-to-empty warn fires and this test would be asserting on the
        // wrong message.
        if (key === "production_runs") {
          return { listProductionRuns: async () => [] }
        }
        return {
          graph: async ({ entity }: any) => {
            if (entity === "order") return { data: [] }
            return {
              data: [
                {
                  id: "run_unlinked",
                  order: null,
                  metadata: { unified_order_id: "order_legacy" },
                },
              ],
            }
          },
        }
      },
    }
    await fetchRunSupersessions(c, ["run_unlinked"])
    const backfillWarns = warn.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("backfill-unified-order-links")
    )
    expect(backfillWarns).toHaveLength(1)
    expect(backfillWarns[0][0]).toContain("run_unlinked")
    expect(backfillWarns[0][0]).toContain("BILL")
  })

  it("stays silent when every run resolves through the link", async () => {
    const warn = jest.fn()
    const c: any = {
      resolve: (key: string) => {
        if (key === "logger") return { warn }
        if (key === "production_runs") {
          return { listProductionRuns: async () => [] }
        }
        return {
          graph: async () => ({
            data: [
              {
                id: "run_linked",
                order: { id: "o1", status: "completed", metadata: {} },
                metadata: {},
              },
            ],
          }),
        }
      },
    }
    await fetchRunSupersessions(c, ["run_linked"])
    expect(warn).not.toHaveBeenCalled()
  })

  it("reads the LINK, and a stale backref cannot override it", async () => {
    const map = await fetchRunSupersessions(
      container(
        [
          {
            id: "run_y",
            order: { id: "order_linked", status: "completed", metadata: {} },
            metadata: { unified_order_id: "order_stale" },
          },
        ],
        false,
        [{ id: "order_stale", status: "canceled", metadata: {} }]
      ),
      ["run_y"]
    )
    // The stale backref says canceled; the authoritative link says alive.
    expect(map.size).toBe(0)
  })
})
