import { planSeedOwnershipRows } from "../set-location-ownership-job"

/**
 * The seed must never say a location is OURS.
 *
 * `is_core` is the one flag that decides whether stock may leave our books.
 * The seed used to compute it as `!isPartnerStoreDefaultLocation` — which is
 * not a definition of ownership. It is "we could not prove this belongs to a
 * partner", and it defaulted the unknown to **ours**.
 *
 * Measured against prod before the change, that rule would have marked NINE
 * locations core:
 *
 *   Le Atelier · Basak Handloom · Haresh Hemraj Manodhiya · Bhagalpur Silks
 *   bismajan · Shramdaan · GOF · Azmat Handloom · Ksaman Naturals Pvt Ltd
 *
 * Six held nothing. One is the bench of the partner currently holding our
 * consigned pashminas — and marking that bench ours bypasses the #2111
 * allocation gate entirely, making the partner's OWN 2 units deductible from
 * our books. Neither of the two genuinely-ours locations (Dharamshala, 1307
 * units; JYT HQ Delhi) appeared in that set: both were already recorded by
 * hand, so the seed skipped them.
 *
 * 🔴 The invariant below is the whole point of this file. If a future change
 * makes the seed clever about guessing ownership, these go red.
 */
describe("planSeedOwnershipRows", () => {
  const LOCATIONS = [
    { id: "sloc_dharamshala", name: "Dharamshala" },
    { id: "sloc_hq", name: "JYT HQ Delhi" },
    { id: "sloc_ksaman", name: "Ksaman Naturals Pvt Ltd" },
    { id: "sloc_gof", name: "GOF" },
    { id: "sloc_gof_wh", name: "GOF Warehouse" },
  ]

  it("🔴 NEVER marks a location core — not even one no partner is linked to", () => {
    const rows = planSeedOwnershipRows(LOCATIONS, new Set(), new Set())
    expect(rows).toHaveLength(5)
    expect(rows.every((r) => r.is_core === false)).toBe(true)
  })

  it("🔴 defaults an UNPROVABLE location to not-ours, and says it was never established", () => {
    // `GOF` is linked to no partner store. The old rule read that as "ours".
    const [row] = planSeedOwnershipRows(
      [{ id: "sloc_gof", name: "GOF" }],
      new Set(),
      new Set()
    )
    expect(row.is_core).toBe(false)
    expect(row.note).toMatch(/NOT established/)
    expect(row.note).toMatch(/set explicitly/)
  })

  it("records a proven partner location as not-ours, and says WHY it is certain", () => {
    const [row] = planSeedOwnershipRows(
      [{ id: "sloc_ksaman", name: "Ksaman Naturals Pvt Ltd" }],
      new Set(["sloc_ksaman"]),
      new Set()
    )
    expect(row.is_core).toBe(false)
    expect(row.note).toBe("seeded: partner store location")
    // The two notes must differ: one is a finding, the other is a default, and
    // an operator scanning the table has to be able to tell them apart.
    expect(row.note).not.toMatch(/NOT established/)
  })

  it("🔴 never overwrites a decision a human already recorded", () => {
    // Dharamshala and JYT HQ Delhi are recorded core on prod. A seed that
    // reset them to false would stop every real deduction we have.
    const rows = planSeedOwnershipRows(
      LOCATIONS,
      new Set(),
      new Set(["sloc_dharamshala", "sloc_hq"])
    )
    expect(rows.map((r) => r.stock_location_id)).toEqual([
      "sloc_ksaman",
      "sloc_gof",
      "sloc_gof_wh",
    ])
  })

  it("is a no-op once every location is recorded", () => {
    expect(
      planSeedOwnershipRows(LOCATIONS, new Set(), new Set(LOCATIONS.map((l) => l.id)))
    ).toEqual([])
  })

  it("falls back to the id when a location has no name, so a row is never anonymous", () => {
    const [row] = planSeedOwnershipRows([{ id: "sloc_x" }], new Set(), new Set())
    expect(row.label).toBe("sloc_x")
  })

  it("skips a malformed row rather than proposing ownership for nothing", () => {
    expect(
      planSeedOwnershipRows([{ id: "" } as any, null as any], new Set(), new Set())
    ).toEqual([])
  })

  it("🔴 the prod case: nine 'not a partner store' locations, none of them ours", () => {
    const unlinked = [
      "Le Atelier",
      "Basak Handloom",
      "Haresh Hemraj Manodhiya",
      "Bhagalpur Silks",
      "bismajan",
      "Shramdaan",
      "GOF",
      "Azmat Handloom",
      "Ksaman Naturals Pvt Ltd",
    ].map((name, i) => ({ id: `sloc_${i}`, name }))

    const rows = planSeedOwnershipRows(unlinked, new Set(), new Set())
    expect(rows).toHaveLength(9)
    expect(rows.filter((r) => r.is_core).length).toBe(0)
  })
})
