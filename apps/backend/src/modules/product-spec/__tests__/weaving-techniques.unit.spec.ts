import {
  SUPPORTED_WEAVES,
  WEAVE_FAMILIES,
  WEAVE_TECHNIQUES,
  validateWeaveParams,
  weaveLabel,
  weaveTechnique,
} from "../weaving-techniques"
import { normalizeHex, normalizeKey } from "../normalize"

describe("weaving catalog (#1342)", () => {
  it("every technique belongs to a listed family", () => {
    // A technique in an unlisted family renders nowhere: the picker groups by
    // WEAVE_FAMILIES, so it would be silently unreachable rather than broken.
    for (const t of WEAVE_TECHNIQUES) {
      expect(WEAVE_FAMILIES).toContain(t.family)
    }
  })

  it("has no duplicate slugs", () => {
    expect(new Set(SUPPORTED_WEAVES).size).toBe(SUPPORTED_WEAVES.length)
  })

  it("every param default sits inside its own range", () => {
    for (const t of WEAVE_TECHNIQUES) {
      for (const p of t.params) {
        expect(p.min).toBeLessThan(p.max)
        expect(p.default).toBeGreaterThanOrEqual(p.min)
        expect(p.default).toBeLessThanOrEqual(p.max)
      }
    }
  })

  it("every preset only sets params its own technique defines", () => {
    // A preset naming a param the technique dropped would auto-fill a value the
    // form cannot show and the workflow then rejects as unknown.
    for (const t of WEAVE_TECHNIQUES) {
      const keys = t.params.map((p) => p.key)
      for (const preset of t.presets) {
        for (const key of Object.keys(preset.params ?? {})) {
          expect(keys).toContain(key)
        }
      }
    }
  })

  it("every preset's params pass the validator they will be saved through", () => {
    for (const t of WEAVE_TECHNIQUES) {
      for (const preset of t.presets) {
        expect(validateWeaveParams(t.slug, preset.params)).toEqual([])
      }
    }
  })

  it("resolves a technique and its label, falling back to the slug", () => {
    expect(weaveTechnique("ikat")?.family).toBe("Ikat & Resist")
    expect(weaveLabel("pashmina-plain")).toBe("Pashmina (plain)")
    expect(weaveTechnique("no-such-weave")).toBeUndefined()
    expect(weaveLabel("no-such-weave")).toBe("no-such-weave")
  })
})

describe("validateWeaveParams", () => {
  it("accepts empty params and rejects an unknown technique", () => {
    expect(validateWeaveParams("plain", null)).toEqual([])
    expect(validateWeaveParams("plain", {})).toEqual([])
    expect(validateWeaveParams("handloom-magic", { gsm: 100 })).toEqual([
      'Unknown weave technique "handloom-magic"',
    ])
  })

  it("rejects a value outside the technique's range", () => {
    const problems = validateWeaveParams("plain", { gsm: 8000 })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("Weight")
    expect(problems[0]).toContain("900")
  })

  it("rejects a param the technique does not define", () => {
    // `shafts` is real — on dobby, not on plain weave.
    expect(validateWeaveParams("plain", { shafts: 8 })).toEqual([
      '"shafts" is not a parameter of Plain weave',
    ])
    expect(validateWeaveParams("dobby", { shafts: 8 })).toEqual([])
  })

  it("rejects a non-numeric value", () => {
    expect(validateWeaveParams("plain", { gsm: "heavy" as any })).toEqual([
      "Weight must be a number",
    ])
  })

  it("honours a technique's own overridden range", () => {
    // Pashmina widens GSM down to 40; plain weave stops at 20 but starts higher
    // in practice — the point is the override is what gets enforced.
    expect(validateWeaveParams("pashmina-plain", { gsm: 45 })).toEqual([])
    expect(validateWeaveParams("pashmina-plain", { gsm: 500 })).toHaveLength(1)
  })

  it("reports every problem, not just the first", () => {
    expect(
      validateWeaveParams("plain", { gsm: 8000, ends_per_inch: 0 })
    ).toHaveLength(2)
  })
})

describe("normalizeHex", () => {
  it("expands shorthand and upper-cases", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC")
    expect(normalizeHex("c9a227")).toBe("#C9A227")
    expect(normalizeHex(" #C9a227 ")).toBe("#C9A227")
  })

  it("treats absent, empty and bare-hash values as no colour", () => {
    // An undyed shade is a real palette entry that no hex describes honestly.
    expect(normalizeHex(null)).toBeNull()
    expect(normalizeHex(undefined)).toBeNull()
    expect(normalizeHex("")).toBeNull()
    expect(normalizeHex("#")).toBeNull()
  })
})

describe("normalizeKey", () => {
  it("makes a partner's label into a stable cross-product key", () => {
    expect(normalizeKey("Pallu type")).toBe("pallu_type")
    expect(normalizeKey("  Zari %  ")).toBe("zari")
    expect(normalizeKey("Warp/Weft ratio")).toBe("warp_weft_ratio")
  })

  it("collapses the many ways one key gets typed onto a single value", () => {
    const written = ["Pallu Type", "pallu-type", "pallu  type", "PALLU_TYPE"]
    expect(new Set(written.map(normalizeKey)).size).toBe(1)
  })
})
