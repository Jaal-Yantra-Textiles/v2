import {
  diffPartnerRegionLinks,
  getMaintenanceJob,
  MAINTENANCE_JOBS,
  MAX_PARTNER_REGION_SCAN,
  repairPartnerRegionLinksJob,
  summarizePartnerRegionRepair,
} from "../registry"

/**
 * #508 slice 4 — pure logic for the `repair-partner-region-links` maintenance
 * job. The container-bound run() (query.graph + remoteLink create/dismiss) is
 * exercised by the API contract integration test; here we lock down the
 * add-missing / remove-orphan / keep-existing decision and the summary string
 * without booting the DB.
 */
describe("repair-partner-region-links — diffPartnerRegionLinks", () => {
  it("adds a missing link when the store default region exists but isn't linked", () => {
    const changes = diffPartnerRegionLinks(
      "partner_1",
      ["reg_1"],
      [],
      new Set(["reg_1"])
    )
    expect(changes).toEqual([
      {
        entity: "partner_region",
        id: "partner_1:reg_1",
        field: "add_link",
        before: null,
        after: "reg_1",
      },
    ])
  })

  it("is a no-op when the default region is already linked", () => {
    const changes = diffPartnerRegionLinks(
      "partner_1",
      ["reg_1"],
      ["reg_1"],
      new Set(["reg_1"])
    )
    expect(changes).toEqual([])
  })

  it("does NOT add a link for a default region that no longer exists (deleted)", () => {
    const changes = diffPartnerRegionLinks(
      "partner_1",
      ["reg_gone"],
      [],
      new Set() // region deleted
    )
    expect(changes).toEqual([])
  })

  it("removes an orphan link whose region was deleted", () => {
    const changes = diffPartnerRegionLinks(
      "partner_1",
      [],
      ["reg_gone"],
      new Set() // region no longer exists
    )
    expect(changes).toEqual([
      {
        entity: "partner_region",
        id: "partner_1:reg_gone",
        field: "remove_orphan_link",
        before: "reg_gone",
        after: null,
      },
    ])
  })

  it("keeps an existing valid link (no change)", () => {
    const changes = diffPartnerRegionLinks(
      "partner_1",
      [],
      ["reg_1"],
      new Set(["reg_1"])
    )
    expect(changes).toEqual([])
  })

  it("handles a mixed partner: add the unlinked default, remove the orphan, keep the valid one", () => {
    const changes = diffPartnerRegionLinks(
      "partner_1",
      ["reg_default"], // exists, not linked → add
      ["reg_orphan", "reg_keep"], // reg_orphan deleted → remove; reg_keep exists → keep
      new Set(["reg_default", "reg_keep"])
    )
    expect(changes).toEqual([
      {
        entity: "partner_region",
        id: "partner_1:reg_default",
        field: "add_link",
        before: null,
        after: "reg_default",
      },
      {
        entity: "partner_region",
        id: "partner_1:reg_orphan",
        field: "remove_orphan_link",
        before: "reg_orphan",
        after: null,
      },
    ])
  })

  it("de-duplicates repeated default/linked region ids", () => {
    const addChanges = diffPartnerRegionLinks(
      "partner_1",
      ["reg_1", "reg_1"], // two stores default to the same region
      [],
      new Set(["reg_1"])
    )
    expect(addChanges).toHaveLength(1)

    const orphanChanges = diffPartnerRegionLinks(
      "partner_1",
      [],
      ["reg_x", "reg_x"],
      new Set()
    )
    expect(orphanChanges).toHaveLength(1)
  })

  it("ignores empty-string region ids", () => {
    const changes = diffPartnerRegionLinks(
      "partner_1",
      [""],
      [""],
      new Set([""])
    )
    expect(changes).toEqual([])
  })
})

describe("repair-partner-region-links — summarizePartnerRegionRepair", () => {
  it("reports no changes when everything is consistent", () => {
    expect(summarizePartnerRegionRepair(true, 3, 0, 0, 0)).toBe(
      "No changes — scanned 3 partner(s), all partner_region links consistent"
    )
  })

  it("uses 'Would' for a dry run and lists both add + remove", () => {
    expect(summarizePartnerRegionRepair(true, 5, 2, 1, 0)).toBe(
      "Would add 2 missing link(s) and remove 1 orphan link(s) across 5 partner(s)"
    )
  })

  it("uses 'Did' for an applied run and appends an error count", () => {
    expect(summarizePartnerRegionRepair(false, 4, 1, 0, 2)).toBe(
      "Did add 1 missing link(s) across 4 partner(s); 2 error(s)"
    )
  })
})

describe("repair-partner-region-links — registry wiring", () => {
  it("is registered and discoverable by id", () => {
    expect(getMaintenanceJob("repair-partner-region-links")).toBe(
      repairPartnerRegionLinksJob
    )
    expect(MAINTENANCE_JOBS).toContain(repairPartnerRegionLinksJob)
  })

  it("declares optional partner_id + limit params and a sane cap", () => {
    expect(MAX_PARTNER_REGION_SCAN).toBeGreaterThan(0)
    const names = repairPartnerRegionLinksJob.params.map((p) => p.name)
    expect(names).toEqual(expect.arrayContaining(["partner_id", "limit"]))
    expect(
      repairPartnerRegionLinksJob.params.every((p) => p.required === false)
    ).toBe(true)
  })
})
