import { describe, expect, it } from "vitest"
import { designTabLabel, MAX_DESIGN_TABS, mergeDesignTabs, otherDesigns } from "../design-tabs"
import { buildDesignChatBody } from "../chat-request"

describe("design tabs (#2556)", () => {
  it("upserts by id and never blanks a known token or name", () => {
    const tabs = mergeDesignTabs(
      [{ design_id: "d1", design_token: "t1", name: "Kurta" }],
      [{ design_id: "d1", name: null }, { design_id: "d2", design_token: "t2" }]
    )
    expect(tabs).toEqual([
      { design_id: "d1", design_token: "t1", name: "Kurta" },
      { design_id: "d2", design_token: "t2" },
    ])
  })

  it(`keeps at most ${MAX_DESIGN_TABS}`, () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ design_id: `d${i}` }))
    expect(mergeDesignTabs([], many)).toHaveLength(MAX_DESIGN_TABS)
  })

  it("sends every design but the active one, with tokens", () => {
    const tabs = [
      { design_id: "d1", design_token: "t1" },
      { design_id: "d2", design_token: "t2", name: "x" },
      { design_id: "d3" },
    ]
    expect(otherDesigns(tabs, "d2")).toEqual([
      { design_id: "d1", design_token: "t1" },
      { design_id: "d3" },
    ])
  })

  it("the request body carries them as context.designs", () => {
    const body = buildDesignChatBody(
      { prefs: {}, designId: "d2", designToken: "t2", designs: [{ design_id: "d1", design_token: "t1" }] },
      "v1"
    )
    expect(body.context).toMatchObject({
      design_id: "d2",
      design_token: "t2",
      designs: [{ design_id: "d1", design_token: "t1" }],
    })
    expect("designs" in buildDesignChatBody({ prefs: {}, designs: [] }, "v1").context).toBe(false)
  })

  it("labels: a real name, else the garment, else a number", () => {
    expect(designTabLabel({ design_id: "a", name: "Indigo kurta" }, 0)).toBe("Indigo kurta")
    expect(designTabLabel({ design_id: "a", name: "New design from your photos", product_type: "shawl" }, 0)).toBe("Shawl")
    expect(designTabLabel({ design_id: "a" }, 2)).toBe("Design 3")
  })
})
