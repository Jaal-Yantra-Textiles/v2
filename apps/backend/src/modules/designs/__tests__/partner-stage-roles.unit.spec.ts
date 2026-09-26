import { draftStagesFromRoster } from "../partner-stage-roles"

describe("draftStagesFromRoster (#2306 S2)", () => {
  it("orders making stages by the default chain, dense and 1-based", () => {
    const plan = draftStagesFromRoster([
      { partner_id: "p_stitch", stage_role: "stitching" },
      { partner_id: "p_weave", stage_role: "weaving" },
      { partner_id: "p_embroider", stage_role: "embroidery" },
    ])
    expect(plan.stages).toEqual([
      { partner_id: "p_weave", stage_role: "weaving", order: 1 },
      { partner_id: "p_embroider", stage_role: "embroidery", order: 2 },
      { partner_id: "p_stitch", stage_role: "stitching", order: 3 },
    ])
  })

  it("gives two partners on the same role the same order, so they run in parallel", () => {
    const plan = draftStagesFromRoster([
      { partner_id: "p_a", stage_role: "embroidery" },
      { partner_id: "p_b", stage_role: "embroidery" },
      { partner_id: "p_c", stage_role: "finishing" },
    ])
    expect(plan.stages.map((s) => [s.partner_id, s.order])).toEqual([
      ["p_a", 1],
      ["p_b", 1],
      ["p_c", 2],
    ])
  })

  it("turns a supplier into a wait, never a stage", () => {
    const plan = draftStagesFromRoster([
      { partner_id: "p_supply", stage_role: "supplier" },
      { partner_id: "p_stitch", stage_role: "stitching" },
    ])
    expect(plan.supplier_partner_ids).toEqual(["p_supply"])
    expect(plan.stages.map((s) => s.partner_id)).toEqual(["p_stitch"])
  })

  it("leaves out photoshoot, sampling and partners with no stage, saying why", () => {
    const plan = draftStagesFromRoster([
      { partner_id: "p_photo", stage_role: "photoshoot" },
      { partner_id: "p_sample", stage_role: "sampling" },
      { partner_id: "p_none", stage_role: null },
      { partner_id: "p_legacy", stage_role: "Sampling For One Client" },
    ])
    expect(plan.stages).toEqual([])
    expect(plan.not_prefilled.map((n) => [n.partner_id, n.reason])).toEqual([
      ["p_photo", "photoshoot is a separate batch task"],
      ["p_sample", "sampling is its own sample run"],
      ["p_none", "no stage chosen"],
      ["p_legacy", "no stage chosen"],
    ])
  })
})
