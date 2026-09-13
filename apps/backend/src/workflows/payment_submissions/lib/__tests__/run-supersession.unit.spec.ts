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
  it("follows metadata.unified_order_id when the D5 link was never backfilled", async () => {
    // The link is authoritative where it EXISTS. The backfill is an ops-run
    // script, so a superseded run can still be link-less — and reading only the
    // link would let it bill.
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
    expect(map.get("run_unlinked")).toMatchObject({
      reason: "superseded_run",
      superseded_by_run_ids: ["run_child"],
      mirror_order_id: "order_legacy",
    })
  })

  it("does not follow the backref when the backref order is alive", async () => {
    const map = await fetchRunSupersessions(
      container(
        [{ id: "run_x", order: null, metadata: { unified_order_id: "order_live" } }],
        false,
        [{ id: "order_live", status: "completed", metadata: {} }]
      ),
      ["run_x"]
    )
    expect(map.size).toBe(0)
  })

  it("prefers the LINK over the backref when both exist", async () => {
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
