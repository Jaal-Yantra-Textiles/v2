jest.mock("../../ai/typesafe", () => {
  const actual = jest.requireActual("../../ai/typesafe")
  return { ...actual, askSystemOne: jest.fn() }
})

import { askSystemOne } from "../../ai/typesafe"
import type { ResolvedClassifier } from "../../ai/classify"
import { classifyEvidence, itemState, proposalFromClasses } from "../classify-evidence"

const CODIV: ResolvedClassifier = { provider: "codiv", url: "https://api.codiv.ai/v1/systemone", model: "openjev-latest", apiKey: "k", platformId: "plat_1" }
const container = { resolve: () => { throw new Error("no logger") } }
import type { ScannedCatalogue, ScannedProduct } from "../types"

const ask = askSystemOne as jest.MockedFunction<typeof askSystemOne>

const item = (title: string, over: Partial<ScannedProduct> = {}): ScannedProduct => ({
  title,
  product_type: null,
  tags: [],
  description: "",
  images: [],
  url: null,
  published_at: null,
  ...over,
})

const cat = (products: ScannedProduct[]): ScannedCatalogue => ({
  platform: "records",
  origin: "records",
  products,
  page_text: "",
  warnings: [],
})

/** A System One reply answering every question of a chunk. */
const reply = (answers: Record<string, [string, number]>) => ({
  model: "jev-latest",
  answers: Object.fromEntries(
    Object.entries(answers).map(([k, [c, conf]]) => [k, { type: "choice" as const, choice: c, confidence: conf, probabilities: {} }])
  ),
})

beforeEach(() => ask.mockReset())

describe("itemState", () => {
  it("sends the name, recorded facts and tags — never free-text notes", () => {
    const s = itemState(item("Tweed Jacket", { description: "Completed run: made 3. Tasks: Stitching. Notes: client in Berlin wants it by Oct", tags: ["production"] }))
    expect(s).toEqual({ name: "Tweed Jacket", recorded: "Completed run: made 3. Tasks: Stitching.", tags: ["production"] })
  })
})

describe("classifyEvidence", () => {
  it("drops an answer below the confidence bar, or outside our options, to 'unclear'", async () => {
    ask.mockResolvedValueOnce(
      reply({
        kind_0: ["shawl", 0.56], tech_0: ["ikat", 1], mat_0: ["pashmina", 1],
        kind_1: ["shawl", 0.3], tech_1: ["levitation", 0.99], mat_1: ["unobtainium", 0.99],
      }) as any
    )
    const out = await classifyEvidence(container, CODIV, [item("Ikat Pashmina"), item("Mystery")])
    // it went to the platform's provider, not the env default
    expect(ask.mock.calls[0][1]).toMatchObject({ apiKey: "k", url: "https://api.codiv.ai/v1/systemone", model: "openjev-latest" })
    expect(out).toEqual([
      { kind: "shawl", technique: "ikat", material: "pashmina" },
      { kind: "unclear", technique: "unclear", material: "unclear" },
    ])
  })

  it("returns null when ANY chunk fails — a partial read would hide evidence", async () => {
    const many = Array.from({ length: 4 }, (_, i) => item(`Item ${i}`)) // Codiv: 3 + 1
    ask.mockResolvedValueOnce(reply({ kind_0: ["fabric", 1] }) as any).mockResolvedValueOnce(null)
    expect(await classifyEvidence(container, { ...CODIV, maxQuestions: 9 }, many)).toBeNull()
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it("stops sending after the first failed request — the caller fails over anyway", async () => {
    ask.mockResolvedValue(null)
    const many = Array.from({ length: 18 }, (_, i) => item(`Item ${i}`)) // Codiv: 6 chunks
    expect(await classifyEvidence(container, { ...CODIV, maxQuestions: 9 }, many)).toBeNull()
    expect(ask.mock.calls.length).toBeLessThanOrEqual(3) // at most one per concurrent worker
  })

  it("🔴 batches by the PROVIDER's question limit — Codiv degrades past ~9 questions", async () => {
    ask.mockResolvedValue(reply({}) as any)
    await classifyEvidence(container, { ...CODIV, maxQuestions: 9 }, Array.from({ length: 9 }, (_, i) => item(`I${i}`)))
    expect(ask).toHaveBeenCalledTimes(3) // 3 items × 3 questions each
    expect(Object.keys((ask.mock.calls[0][0] as any).questions)).toHaveLength(9)
    ask.mockClear()
    await classifyEvidence(container, { ...CODIV, provider: "typesafe", maxQuestions: 36 }, Array.from({ length: 9 }, (_, i) => item(`I${i}`)))
    expect(ask).toHaveBeenCalledTimes(1)
  })
})

describe("proposalFromClasses", () => {
  it("groups by kind × technique (× material for cloth), and leaves unclear items out", () => {
    const products = [
      item("Kala Cotton — Rust", { hints: { actions: [], material: "Kala Cotton" }, published_at: "2026-03-01T00:00:00Z" }),
      item("Kala Cotton — Red", { hints: { actions: [], material: "Kala Cotton" }, published_at: "2025-08-02T00:00:00Z" }),
      item("Tussar Silk", { hints: { actions: [], material: "Tussar Silk" } }),
      item("Princess Highway", { hints: { actions: ["stitch"] } }),
    ]
    const p = proposalFromClasses(cat(products), [
      { kind: "fabric", technique: "unclear", material: "kala_cotton" },
      { kind: "fabric", technique: "unclear", material: "kala_cotton" },
      { kind: "fabric", technique: "unclear", material: "tussar" },
      { kind: "unclear", technique: "stitched", material: "unclear" },
    ])
    expect(p.grouped_by).toBe("typesafe")
    expect(p.samples.map((s) => [s.title, s.material, s.evidence.length, s.captured_at?.slice(0, 10)])).toEqual([
      ["Kala cotton fabric", "kala cotton", 2, "2025-08-02"],
      ["Tussar silk fabric", "tussar silk", 1, undefined],
    ])
    expect(p.warnings.join()).toMatch(/1 item\(s\) could not be classified/)
  })

  it("🔴 never credits a partner with the CLOTH's technique — records say what they did", () => {
    // Sharlho stitched a jacket from handwoven tweed: technique handloom is true
    // of the item, but the partner's action is stitch, from the run's tasks.
    const p = proposalFromClasses(
      cat([item("Hand-Woven Wool Tweed Jacket", { hints: { actions: ["stitch"], material: "Tweed wool" } })]),
      [{ kind: "jacket", technique: "handloom", material: "wool" }]
    )
    expect(p.samples[0]).toMatchObject({ title: "Handloom wool jacket", technique: "handloom", actions: ["stitch"] })
  })

  it("derives actions from technique only for website evidence, which has no records", () => {
    const p = proposalFromClasses(
      { ...cat([item("Block Printed Stole")]), platform: "shopify", origin: "https://x.example" },
      [{ kind: "stole", technique: "block_print", material: "cotton" }]
    )
    expect(p.samples[0]).toMatchObject({ title: "Block printed cotton stole", actions: ["print"] })
  })

  it("does not split one kind into two identical titles over 'stitched' vs 'unclear'", () => {
    const p = proposalFromClasses(
      cat([item("Trouser A", { hints: { actions: [] } }), item("Trouser B", { hints: { actions: [] } })]),
      [
        { kind: "trousers", technique: "stitched", material: "cotton" },
        { kind: "trousers", technique: "unclear", material: "cotton" },
      ]
    )
    expect(p.samples.map((s) => [s.title, s.evidence.length])).toEqual([["Cotton trousers", 2]])
  })

  it("names a material only when the evidence agrees on one", () => {
    const p = proposalFromClasses(
      cat([item("Jacket A", { hints: { actions: ["stitch"] } }), item("Jacket B", { hints: { actions: ["stitch"] } })]),
      [
        { kind: "jacket", technique: "stitched", material: "wool" },
        { kind: "jacket", technique: "stitched", material: "cotton" },
      ]
    )
    expect(p.samples).toHaveLength(1)
    expect(p.samples[0]).toMatchObject({ title: "Jacket", material: null, technique: null })
  })
})
