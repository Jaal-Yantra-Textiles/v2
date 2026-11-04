import {
  mergeIssuedKeys,
  transferredMaterialKeysByRun,
} from "../lib/transferred-material"

/**
 * Consignment by transfer: which `${item}@${location}` keys a run may deduct
 * our cloth at. Pure — the reader around it is covered by the job spec.
 */
describe("transferredMaterialKeysByRun", () => {
  const delivered = (item: string, to: string, status = "delivered") => ({
    inventory_item_id: item,
    to_location_id: to,
    status,
  })

  it("keys a delivered transfer into the run's own partner location", () => {
    const out = transferredMaterialKeysByRun(
      [{ run_id: "run_a", location_id: "sloc_a" }],
      [delivered("iitem_denim", "sloc_a")]
    )
    expect(Array.from(out.run_a)).toEqual(["iitem_denim@sloc_a"])
  })

  it("never gives a run keys at another partner's location", () => {
    const out = transferredMaterialKeysByRun(
      [
        { run_id: "run_a", location_id: "sloc_a" },
        { run_id: "run_b", location_id: "sloc_b" },
      ],
      [delivered("iitem_denim", "sloc_b")]
    )
    expect(out.run_a).toBeUndefined()
    expect(Array.from(out.run_b)).toEqual(["iitem_denim@sloc_b"])
  })

  it("ignores transfers not yet counted in, and runs with no resolved location", () => {
    const out = transferredMaterialKeysByRun(
      [
        { run_id: "run_a", location_id: "sloc_a" },
        { run_id: "run_none", location_id: null },
      ],
      [
        delivered("iitem_denim", "sloc_a", "in_transit"),
        delivered("iitem_denim", "sloc_a", "cancelled"),
        delivered("iitem_wool", "sloc_a", "draft"),
      ]
    )
    expect(out).toEqual({})
  })

  it("merges with allocation keys without mutating either side", () => {
    const a = { run_a: new Set(["iitem_x@sloc_1"]) }
    const b = { run_a: new Set(["iitem_y@sloc_2"]), run_b: new Set(["iitem_z@sloc_3"]) }
    const out = mergeIssuedKeys(a, b)
    expect(Array.from(out.run_a).sort()).toEqual(["iitem_x@sloc_1", "iitem_y@sloc_2"])
    expect(Array.from(out.run_b)).toEqual(["iitem_z@sloc_3"])
    expect(a.run_a.size).toBe(1)
  })
})
