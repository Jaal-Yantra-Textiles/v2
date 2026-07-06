/**
 * Unit test — buildTechPackInputFromDesign (#892)
 *
 * Pure mapper: a design graph → TechPackSceneInput. Asserts each section is sourced
 * from the right place and that sparse designs still yield a valid input.
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="techpack-input-from-design"
 */
import { buildTechPackInputFromDesign } from "../techpack-input-from-design"
import { buildMoodboardScene } from "../build-moodboard-scene"

describe("buildTechPackInputFromDesign", () => {
  const design = {
    name: "Craft Revival Top",
    design_type: "Original",
    thumbnail_url: "https://cdn.example.com/front.png",
    metadata: {
      style_code: "SS26–CR–TP-08",
      season: "SS26",
      garment_type: "blouse",
      measurement_unit: "cm",
      flats: { back_image_url: "https://cdn.example.com/back.png" },
    },
    color_palette: [
      { name: "Indigo", hex_code: "#2e3a59", thread_ref: "K-7" },
      { label: "Madder", hex: "#a83232" },
      { name: "no-hex" }, // dropped — no colour value
    ],
    size_sets: [{ size_label: "M", measurements: { total_length_hps: 66 } }],
    specifications: [
      {
        title: "Waist dart",
        category: "Construction",
        special_instructions: "clip at apex",
        metadata: {
          technique: "dart",
          params: { intake: 0.6 },
          fabricRules: ["press toward CF"],
        },
      },
      {
        title: "Sleeve gathers",
        category: "Construction",
        metadata: { technique: "gathers", params: { ratio: 1.6 } },
      },
      {
        // Construction spec with no technique → skipped, not rendered anonymously.
        title: "General note",
        category: "Construction",
        metadata: {},
      },
      {
        // Non-construction spec → never a detail.
        title: "Care label",
        category: "Finishing",
        metadata: { technique: "dart" },
      },
    ],
  }

  const input = buildTechPackInputFromDesign(design)

  it("maps header from name + metadata hints", () => {
    expect(input.design.title).toBe("Craft Revival Top")
    expect(input.design.style_code).toBe("SS26–CR–TP-08")
    expect(input.garment_type).toBe("blouse")
  })

  it("takes front flat from thumbnail and back from metadata", () => {
    expect(input.flats.front_image_url).toBe("https://cdn.example.com/front.png")
    expect(input.flats.back_image_url).toBe("https://cdn.example.com/back.png")
  })

  it("maps the size set with the metadata unit", () => {
    expect(input.sizeSet?.size_label).toBe("M")
    expect(input.sizeSet?.unit).toBe("cm")
    expect(input.sizeSet?.measurements.total_length_hps).toBe(66)
  })

  it("normalizes colorways and drops entries with no colour value", () => {
    expect(input.colorways).toHaveLength(2)
    expect(input.colorways?.[0]).toEqual({
      name: "Indigo",
      hex_code: "#2e3a59",
      thread_ref: "K-7",
    })
    expect(input.colorways?.[1]).toEqual({ name: "Madder", hex_code: "#a83232" })
  })

  it("sources details only from Construction specs that declare a technique", () => {
    expect(input.details).toHaveLength(2)
    expect(input.details?.map((d) => d.technique)).toEqual(["dart", "gathers"])
    const dart = input.details?.[0]
    expect(dart?.label).toBe("Waist dart")
    expect(dart?.params).toEqual({ intake: 0.6 })
    expect(dart?.fabricRules).toEqual(["press toward CF"])
    expect(dart?.note).toBe("clip at apex")
  })

  it("feeds a buildable scene (round-trips through the scene builder)", () => {
    const scene = buildMoodboardScene(input)
    const frameNames = scene.elements
      .filter((e) => e.type === "frame")
      .map((f) => f.name)
    expect(frameNames).toContain("4 · Construction details")
  })

  it("yields a valid minimal input for a sparse design", () => {
    const minimal = buildTechPackInputFromDesign({ name: "Solo" })
    expect(minimal.design.title).toBe("Solo")
    expect(minimal.garment_type).toBe("garment")
    expect(minimal.sizeSet).toBeUndefined()
    expect(minimal.colorways).toBeUndefined()
    expect(minimal.details).toBeUndefined()
    // And the scene builder accepts it.
    expect(() => buildMoodboardScene(minimal)).not.toThrow()
  })
})
