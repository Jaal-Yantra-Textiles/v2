import {
  backfillPartnerStockLocationsJob,
  getMaintenanceJob,
  parsePartnerLocationPairs,
} from "../registry"

/**
 * #2053 — `backfill-partner-stock-locations`.
 *
 * Prod on 2026-09-14: **17 of 30 partners had no store**, so
 * `resolvePartnerLocationStep`'s `partner → stores[0] → channel → locations[0]`
 * walk returned nothing and their finished goods were never banked. Seven of
 * those partners already owned a real warehouse the walk could not reach.
 *
 * The job's `run()` only touches `query.graph` and the link service, so a fake
 * container exercises the whole audit here — the classification is the part
 * worth locking down, not the plumbing.
 */
describe("parsePartnerLocationPairs", () => {
  it("parses partner:location pairs", () => {
    expect(parsePartnerLocationPairs("p_1:sloc_1,p_2:sloc_2")).toEqual({
      pairs: [
        { partner_id: "p_1", location_id: "sloc_1" },
        { partner_id: "p_2", location_id: "sloc_2" },
      ],
      malformed: [],
    })
  })

  it("tolerates whitespace and empty segments", () => {
    expect(parsePartnerLocationPairs(" p_1 : sloc_1 , , p_2:sloc_2 ").pairs).toEqual([
      { partner_id: "p_1", location_id: "sloc_1" },
      { partner_id: "p_2", location_id: "sloc_2" },
    ])
  })

  /**
   * A dropped pair reads as "already linked": the job reports success and the
   * partner silently stays unable to receive stock.
   */
  it("reports malformed entries instead of dropping them", () => {
    const out = parsePartnerLocationPairs("p_1:sloc_1,garbage,p_2:,:sloc_3,a:b:c")
    expect(out.pairs).toEqual([{ partner_id: "p_1", location_id: "sloc_1" }])
    expect(out.malformed).toEqual(["garbage", "p_2:", ":sloc_3", "a:b:c"])
  })

  it("returns nothing for empty input", () => {
    expect(parsePartnerLocationPairs(undefined)).toEqual({ pairs: [], malformed: [] })
    expect(parsePartnerLocationPairs("")).toEqual({ pairs: [], malformed: [] })
    expect(parsePartnerLocationPairs("  ,  ")).toEqual({ pairs: [], malformed: [] })
  })
})

describe("backfill-partner-stock-locations", () => {
  /** Mirrors the prod shape: some partners linked, some on the legacy chain, some stranded. */
  const PARTNERS = [
    // Linked directly — healthy.
    { id: "p_linked", name: "Sharlho", stock_locations: [{ id: "sloc_sharlho" }], stores: [] },
    // No link, but the legacy store chain still reaches exactly one location.
    {
      id: "p_chain",
      name: "Unique Pashmina",
      stock_locations: [],
      stores: [{ id: "store_up", default_sales_channel_id: "sc_up" }],
    },
    // No link, no store — the 17.
    { id: "p_stranded", name: "Kiyo Beauty", stock_locations: [], stores: [] },
    // Store exists but names no sales channel.
    {
      id: "p_nochannel",
      name: "Prince Tailors",
      stock_locations: [],
      stores: [{ id: "store_pt", default_sales_channel_id: null }],
    },
    // Two links — ambiguous, the resolver refuses.
    {
      id: "p_ambiguous",
      name: "Two Warehouses",
      stock_locations: [{ id: "sloc_a" }, { id: "sloc_b" }],
      stores: [],
    },
  ]

  const LOCATIONS = [
    { id: "sloc_sharlho", name: "Sharlho Store Warehouse" },
    { id: "sloc_up", name: "Unique Pashmina Store Warehouse" },
    { id: "sloc_a", name: "A" },
    { id: "sloc_b", name: "B" },
    // The real case: a warehouse nothing can reach. Kiyo Beauty owns it.
    { id: "sloc_kiyo", name: "Kiyo Designs" },
  ]

  const makeContainer = (opts: { onCreate?: (p: any) => void; createThrows?: boolean } = {}) => ({
    resolve: (key: string) => {
      if (String(key).toLowerCase().includes("link") && !String(key).toLowerCase().includes("query")) {
        return {
          create: async (payload: any) => {
            if (opts.createThrows) throw new Error("link failed")
            opts.onCreate?.(payload)
          },
        }
      }
      return {
        graph: async (args: any) => {
          if (args.entity === "partners") return { data: PARTNERS }
          if (args.entity === "stock_locations") return { data: LOCATIONS }
          if (args.entity === "sales_channels") {
            return { data: [{ id: "sc_up", stock_locations: [{ id: "sloc_up" }] }] }
          }
          return { data: [] }
        },
      }
    },
  })

  it("is registered so an operator can actually reach it", () => {
    expect(getMaintenanceJob("backfill-partner-stock-locations")).toBe(
      backfillPartnerStockLocationsJob
    )
  })

  describe("audit mode (no params)", () => {
    it("names every partner that cannot bank goods, and why", async () => {
      const res = await backfillPartnerStockLocationsJob.run(makeContainer(), {
        dry_run: true,
        params: {},
      })
      const stranded = res.changes.filter((c) => c.entity === "partner")
      expect(stranded.map((c) => c.id).sort()).toEqual(
        ["p_ambiguous", "p_nochannel", "p_stranded"].sort()
      )
      // The reason must be in the note — an id list alone cannot be argued with.
      expect(stranded.find((c) => c.id === "p_stranded")!.note).toMatch(
        /no linked stock location AND no store/
      )
      expect(stranded.find((c) => c.id === "p_nochannel")!.note).toMatch(
        /store has no default sales channel/
      )
      expect(stranded.find((c) => c.id === "p_ambiguous")!.note).toMatch(/ambiguous/)
    })

    it("does not flag partners the link OR the legacy chain can answer", async () => {
      const res = await backfillPartnerStockLocationsJob.run(makeContainer(), {
        dry_run: true,
        params: {},
      })
      const ids = res.changes.filter((c) => c.entity === "partner").map((c) => c.id)
      expect(ids).not.toContain("p_linked")
      expect(ids).not.toContain("p_chain")
    })

    it("surfaces the warehouses no partner can reach — the other half of the pairing", async () => {
      const res = await backfillPartnerStockLocationsJob.run(makeContainer(), {
        dry_run: true,
        params: {},
      })
      const orphans = res.changes.filter((c) => c.entity === "stock_location")
      expect(orphans.map((c) => c.id)).toEqual(["sloc_kiyo"])
      expect(orphans[0].note).toMatch(/Kiyo Designs/)
    })

    // An audit is a read. dry_run=false must not make it claim it changed something.
    it("never reports applied, even when dry_run is false", async () => {
      const res = await backfillPartnerStockLocationsJob.run(makeContainer(), {
        dry_run: false,
        params: {},
      })
      expect(res.applied).toBe(false)
    })
  })

  describe("repair mode (pairs)", () => {
    it("creates the link for a stranded partner", async () => {
      const created: any[] = []
      const res = await backfillPartnerStockLocationsJob.run(
        makeContainer({ onCreate: (p) => created.push(p) }),
        { dry_run: false, params: { pairs: "p_stranded:sloc_kiyo" } }
      )
      expect(created).toHaveLength(1)
      expect(res.applied).toBe(true)
      expect(res.changes[0].after).toEqual({
        partner_id: "p_stranded",
        stock_location_id: "sloc_kiyo",
      })
    })

    it("writes nothing on a dry run but still shows the change", async () => {
      const created: any[] = []
      const res = await backfillPartnerStockLocationsJob.run(
        makeContainer({ onCreate: (p) => created.push(p) }),
        { dry_run: true, params: { pairs: "p_stranded:sloc_kiyo" } }
      )
      expect(created).toHaveLength(0)
      expect(res.applied).toBe(false)
      expect(res.changes).toHaveLength(1)
      expect(res.summary).toMatch(/^Would link 1/)
    })

    /**
     * Adding a second warehouse to a partner that already has one does not fix
     * them — it makes the resolution ambiguous and stops them banking goods at
     * all. A "backfill" that breaks a working partner must refuse.
     */
    it("refuses to give a partner a second warehouse", async () => {
      const created: any[] = []
      const res = await backfillPartnerStockLocationsJob.run(
        makeContainer({ onCreate: (p) => created.push(p) }),
        { dry_run: false, params: { pairs: "p_linked:sloc_kiyo" } }
      )
      expect(created).toHaveLength(0)
      expect(res.changes).toHaveLength(0)
      expect(res.errors?.[0].message).toMatch(/already has 1 linked stock location/)
    })

    it("is idempotent — re-linking an existing pair is a no-op, not an error", async () => {
      const created: any[] = []
      const res = await backfillPartnerStockLocationsJob.run(
        makeContainer({ onCreate: (p) => created.push(p) }),
        { dry_run: false, params: { pairs: "p_linked:sloc_sharlho" } }
      )
      expect(created).toHaveLength(0)
      expect(res.changes).toHaveLength(0)
      expect(res.errors ?? []).toHaveLength(0)
    })

    it("rejects unknown ids rather than creating a dangling link", async () => {
      const res = await backfillPartnerStockLocationsJob.run(makeContainer(), {
        dry_run: false,
        params: { pairs: "p_nope:sloc_kiyo,p_stranded:sloc_nope" },
      })
      expect(res.changes).toHaveLength(0)
      expect(res.errors).toHaveLength(2)
      expect(res.errors![0].message).toMatch(/No such partner/)
      expect(res.errors![1].message).toMatch(/No such stock location/)
    })

    it("records a failed link as an error instead of claiming success", async () => {
      const res = await backfillPartnerStockLocationsJob.run(
        makeContainer({ createThrows: true }),
        { dry_run: false, params: { pairs: "p_stranded:sloc_kiyo" } }
      )
      expect(res.changes).toHaveLength(0)
      expect(res.applied).toBe(false)
      expect(res.errors?.[0].message).toMatch(/link failed/)
    })

    it("carries malformed pairs through as errors", async () => {
      const res = await backfillPartnerStockLocationsJob.run(makeContainer(), {
        dry_run: true,
        params: { pairs: "garbage" },
      })
      expect(res.errors?.[0].message).toMatch(/Malformed pair/)
    })
  })
})
