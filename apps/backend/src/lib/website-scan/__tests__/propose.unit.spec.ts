import {
  buildScanPrompt,
  fallbackProposal,
  productNounFromTitle,
  modelAnswerSchema,
  proposalFromModel,
} from "../propose"
import type { ScannedCatalogue } from "../types"

const catalogue = (): ScannedCatalogue => ({
  platform: "shopify",
  origin: "https://gof.example",
  page_text: "Handspun, handwoven in Bengal.",
  warnings: [],
  products: [
    { title: "Muslin 150s White", product_type: "Fabric", tags: ["muslin"], description: "Handspun handwoven muslin", images: ["https://cdn/a.jpg", "https://cdn/b.jpg"], url: "https://gof.example/products/m1", published_at: "2026-03-25T00:00:00Z" },
    { title: "Muslin 150s Earthy", product_type: "Fabric", tags: ["muslin"], description: "Handspun handwoven muslin", images: ["https://cdn/c.jpg"], url: "https://gof.example/products/m2", published_at: "2025-10-11T00:00:00Z" },
    { title: "Jamdani Saree", product_type: "Saree", tags: [], description: "", images: [], url: "https://gof.example/products/j", published_at: null },
  ],
})

describe("proposalFromModel", () => {
  it("takes photos, URL and date from the EVIDENCE, never from the model", () => {
    const answer = modelAnswerSchema.parse({
      capabilities: [
        {
          title: "Handspun handwoven muslin",
          product_type: "yardage",
          technique: "handspun, handwoven",
          material: "cotton muslin 150s",
          actions: ["Weave", "spin", "levitate"],
          product_indexes: [1, 0],
          // a model that invents evidence must be ignored
          image_urls: ["https://evil/fake.jpg"],
          captured_at: "2020-01-01",
        },
      ],
    })
    const p = proposalFromModel(catalogue(), answer)
    expect(p.grouped_by).toBe("model")
    expect(p.samples).toHaveLength(1)
    const s = p.samples[0]
    expect(s.actions).toEqual(["spin", "weave"]) // vocabulary order, unknown dropped
    expect(s.image_urls).toEqual(["https://cdn/c.jpg", "https://cdn/a.jpg", "https://cdn/b.jpg"])
    expect(s.captured_at).toBe("2025-10-11T00:00:00.000Z") // the EARLIEST publish date
    expect(s.source_url).toBe("https://gof.example/products/m2")
    expect(s.evidence).toEqual(["Muslin 150s Earthy", "Muslin 150s White"])
  })

  it("drops a capability whose only evidence is an index off the list", () => {
    const p = proposalFromModel(
      catalogue(),
      modelAnswerSchema.parse({ capabilities: [{ title: "Pashmina", product_indexes: [7, -1] }] })
    )
    expect(p.samples).toEqual([])
    expect(p.warnings.join()).toMatch(/Dropped "Pashmina"/)
  })

  it("links knowledge to the capability it names, and a partner-wide fact to none", () => {
    const p = proposalFromModel(
      catalogue(),
      modelAnswerSchema.parse({
        capabilities: [
          { title: "Muslin", product_indexes: [0] },
          { title: "Jamdani", product_indexes: [2] },
        ],
        knowledge: [
          { fact: "Weaves 150s count muslin", capability_index: 0 },
          { fact: "Jamdani takes 3 weeks per saree", product_index: 2 },
          { fact: "Works in Bengal", capability_index: null },
          { fact: "works in bengal" }, // duplicate, case-insensitive
          { fact: "  " },
        ],
      })
    )
    expect(p.knowledge.map((k) => [k.fact, k.sample_key])).toEqual([
      ["Weaves 150s count muslin", "s1"],
      ["Jamdani takes 3 weeks per saree", "s2"],
      ["Works in Bengal", null],
    ])
    expect(p.knowledge[1].source_url).toBe("https://gof.example/products/j")
    expect(p.knowledge[2].source_url).toBe("https://gof.example")
  })

  it("treats a 'null'/'unknown' string as absent, not as a material", () => {
    const p = proposalFromModel(
      catalogue(),
      modelAnswerSchema.parse({ capabilities: [{ title: "Saree", material: "unknown", technique: "null", product_indexes: [2] }] })
    )
    expect(p.samples[0].material).toBeNull()
    expect(p.samples[0].technique).toBeNull()
    expect(p.samples[0].captured_at).toBeNull() // no date on the site: commit uses scan date
  })
})

describe("fallbackProposal", () => {
  it("groups by the site's product_type and says technique was not read", () => {
    const p = fallbackProposal(catalogue(), "the model is switched off")
    expect(p.grouped_by).toBe("fallback")
    expect(p.samples.map((s) => [s.title, s.evidence.length])).toEqual([
      ["Fabric", 2],
      ["Saree", 1],
    ])
    expect(p.samples.every((s) => s.technique === null && s.actions.length === 0)).toBe(true)
    expect(p.warnings.join()).toMatch(/NOT read/)
  })
})

describe("productNounFromTitle", () => {
  it.each([
    ["Hand Woven Pure Merino Wool Kullu Stole-Magenta", "stole"],
    ["Himachali cap with flower border ( Pattern colour may vary)", "cap"],
    ["Handwoven Himdhara Bloom Merino Kullu Shawl - White", "shawl"],
    ["Men's Pure Merino Wool Kullu Diamond Border Shawl White", "shawl"],
    ["Tussar Silk Sari", "saree"],
    ["pattu 06", "pattu"],
    ["Himalayan Ruby", null],
  ])("%s → %s", (title, noun) => {
    expect(productNounFromTitle(title)).toBe(noun)
  })
})

describe("fallbackProposal grouping", () => {
  it("groups colourways by the head noun and ignores merchandising labels", () => {
    const cat = catalogue()
    cat.products = [
      { ...cat.products[0], title: "Kullu Shawl - White", product_type: "New Arrival" },
      { ...cat.products[0], title: "Kullu Shawl - Maroon", product_type: null },
      { ...cat.products[0], title: "Kullu Stole-Magenta", product_type: null },
      { ...cat.products[0], title: "Himalayan Ruby", product_type: null },
    ]
    const p = fallbackProposal(cat, "test")
    expect(p.samples.map((s) => [s.title, s.product_type, s.evidence.length])).toEqual([
      ["Shawl", "shawl", 2],
      ["Stole", "stole", 1],
      ["Other products", null, 1],
    ])
  })
})

describe("records-specific grouping", () => {
  it("tells supplied cloth apart by material, not one 'fabric' bucket", () => {
    const cat = catalogue()
    const line = (title: string, material: string) => ({ ...cat.products[0], title, product_type: "fabric", images: [], hints: { material, actions: [] } })
    cat.products = [line("Linen — White", "Linen"), line("Linen — Natural", "Linen"), line("Tussar — Gold", "Tussar Silk")]
    const p = fallbackProposal(cat, "test")
    expect(p.samples.map((s) => [s.title, s.product_type, s.material, s.evidence.length])).toEqual([
      ["Linen fabric", "fabric", "Linen", 2],
      ["Tussar Silk fabric", "fabric", "Tussar Silk", 1],
    ])
  })

  it("drops a model 'fact' that only restates an evidence row", () => {
    const p = proposalFromModel(
      catalogue(),
      modelAnswerSchema.parse({
        capabilities: [{ title: "Muslin", product_indexes: [0] }],
        knowledge: [
          { fact: "16.5 units of check fabrics on order 01K36TE2WB5BQR1MS6KESXP7Q3", capability_index: 0 },
          { fact: "Weaves 150s count muslin", capability_index: 0 },
        ],
      })
    )
    expect(p.knowledge.map((k) => k.fact)).toEqual(["Weaves 150s count muslin"])
  })
})

describe("buildScanPrompt", () => {
  it("numbers products so the model can only answer by index", () => {
    const text = buildScanPrompt(catalogue())
    expect(text).toContain("[0] Muslin 150s White | type: Fabric")
    expect(text).toContain("[2] Jamdani Saree")
    expect(text).not.toContain("cdn/a.jpg") // images are never shown to the model
  })
})
