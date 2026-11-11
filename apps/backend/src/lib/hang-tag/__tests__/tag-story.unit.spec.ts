import { buildTagStory, craftPhrase, stagePhrase } from "../tag-story"
import { pickLead, pickPlace } from "../load-tag-story"
import type { ProductionStory } from "../../../api/store/custom/designs/production-story-lib/build-story"

/**
 * The hang-tag story is printed and handed to an end customer (#2541), so
 * these tests pin two things: the sentence it writes from real records, and
 * that it says nothing where the records are silent.
 */

const story = (over: Partial<ProductionStory> = {}): ProductionStory => ({
  design_id: "des_1",
  runs: [],
  consumption: {
    energy: { electricity_kwh: 0, water_liters: 0, gas_cubic_meters: 0 },
    labor_hours: 0,
    materials_consumed: [],
    total_logs: 0,
  },
  people: [],
  partners: [{ id: "p_ksaman", name: "Ksaman Naturals", stage_role: "stitching" }],
  materials: [
    {
      id: "rm_kala",
      name: "33s Kala Cotton (H.S+H.W)",
      composition: "100% Kala Cotton",
      color: "Red",
      media: null,
      material_type: null,
      supplier: { id: "p_gof", name: "GOF Asia" },
    },
  ],
  ...over,
})

const facts = {
  p_gof: { lead: "Rahul Ghosh", place: "Islampur, West Bengal" },
  p_ksaman: { lead: "Geetanjali Sharma", place: "Bhubaneswar, Odisha" },
}

describe("buildTagStory", () => {
  it("tells the fabric house first, then the maker, from records", () => {
    const out = buildTagStory({
      story: story(),
      partnerFacts: facts,
      techniques: { rm_kala: "HandSpun + HandWoven" },
    })
    expect(out.text).toBe(
      "This began in Islampur, West Bengal, where Rahul Ghosh and the GOF Asia team spin and weave cloth by hand. " +
        "The cloth then travelled to Bhubaneswar, Odisha, where Geetanjali Sharma and the Ksaman Naturals team cut and stitched it."
    )
    expect(out.makers.map((m) => m.id)).toEqual(["p_ksaman"])
    expect(out.fabrics[0]).toMatchObject({ technique: "HandSpun + HandWoven", supplier: { lead: "Rahul Ghosh" } })
  })

  it("names a partner without a place rather than guessing one", () => {
    const out = buildTagStory({
      story: story(),
      partnerFacts: { p_gof: { lead: null, place: null }, p_ksaman: { lead: null, place: null } },
      techniques: {},
    })
    expect(out.text).toBe(
      "This began with the GOF Asia team, who make the cloth. Then the Ksaman Naturals team cut and stitched it."
    )
  })

  it("gives a fabric with no purchase order no supplier, and writes only the maker", () => {
    const s = story()
    s.materials[0].supplier = null
    const out = buildTagStory({ story: s, partnerFacts: facts, techniques: {} })
    expect(out.fabrics[0].supplier).toBeNull()
    expect(out.text).toBe("This was made in Bhubaneswar, Odisha by Geetanjali Sharma and the Ksaman Naturals team.")
  })

  it("does not send the cloth on a journey when the fabric house also stitched it", () => {
    const out = buildTagStory({
      story: story({ partners: [{ id: "p_gof", name: "GOF Asia", stage_role: "stitching" }] }),
      partnerFacts: facts,
      techniques: { rm_kala: "HandWoven" },
    })
    expect(out.text).toBe(
      "This began in Islampur, West Bengal, where Rahul Ghosh and the GOF Asia team weave cloth on the handloom. They also cut and stitched it."
    )
  })

  it("returns an empty paragraph when the records hold nothing", () => {
    const out = buildTagStory({
      story: story({ partners: [], materials: [] }),
      partnerFacts: {},
      techniques: {},
    })
    expect(out.text).toBe("")
  })

  it("never writes an em dash", () => {
    const out = buildTagStory({ story: story(), partnerFacts: facts, techniques: {} })
    expect(out.text).not.toMatch(/—/)
  })
})

describe("phrases", () => {
  it("reads the craft from the technique", () => {
    expect(craftPhrase(["HandWoven"])).toBe("weave cloth on the handloom")
    expect(craftPhrase(["HandSpun + HandWoven"])).toBe("spin and weave cloth by hand")
    expect(craftPhrase([null])).toBe("make the cloth")
  })
  it("reads the stage verb", () => {
    expect(stagePhrase("stitching")).toBe("cut and stitched it")
    expect(stagePhrase("embroidery")).toBe("embroidered it")
    expect(stagePhrase(null)).toBe("made it")
  })
})

describe("pickLead / pickPlace", () => {
  it("prefers the owner and skips '-' placeholder surnames", () => {
    expect(
      pickLead([
        { first_name: "Taruu", last_name: "Sharma", role: "admin" },
        { first_name: "Sashi", last_name: "-", role: "owner" },
      ])
    ).toBe("Sashi")
  })
  it("gives no place when warehouses disagree", () => {
    expect(pickPlace([{ address: { city: "Bhubaneswar", province: "Odisha" } }])).toBe("Bhubaneswar, Odisha")
    expect(
      pickPlace([
        { address: { city: "Delhi", province: "Delhi" } },
        { address: { city: "Dharamshala", province: "Himachal Pradesh" } },
      ])
    ).toBeNull()
  })
})
