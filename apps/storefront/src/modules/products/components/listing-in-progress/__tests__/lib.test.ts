import { describe, it, expect } from "vitest"
import { listingJourney } from "../lib"

describe("listingJourney", () => {
  it("shows the generic journey when there is no production story", () => {
    for (const crafted of [null, undefined, { fabrics: [], makers: [] }]) {
      const { steps, fromStory } = listingJourney(crafted)
      expect(fromStory).toBe(false)
      expect(steps.map((s) => s.title)).toEqual([
        "Design",
        "Weave",
        "Dye",
        "Stitch",
        "Photoshoot",
      ])
    }
  })

  it("puts the real fabrics and makers in the journey", () => {
    const { steps, fromStory } = listingJourney({
      fabrics: [{ id: "rm1", name: "Kala Cotton", supplier: "HR Handloom" }],
      makers: [{ id: "p1", verb: "Stitched by", name: "Sharlho" }],
    })
    expect(fromStory).toBe(true)
    expect(steps.map((s) => [s.title, s.detail])).toEqual([
      ["Design", "Drawn and sampled"],
      ["Kala Cotton", "Fabric from HR Handloom"],
      ["Sharlho", "Stitched by"],
      ["Photoshoot", "Being photographed"],
    ])
  })

  it("marks only the photoshoot as happening now", () => {
    const { steps } = listingJourney({
      fabrics: [],
      makers: [{ id: "p1", verb: "Woven by", name: "Asha" }],
    })
    expect(steps.filter((s) => s.current).map((s) => s.id)).toEqual(["photoshoot"])
    expect(steps[steps.length - 1].current).toBe(true)
  })
})
