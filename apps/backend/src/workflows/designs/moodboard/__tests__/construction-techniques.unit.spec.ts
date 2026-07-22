/**
 * Unit test — canonical construction-techniques catalog (#1113 Feature B).
 *
 * Guards the single-source-of-truth invariants: the catalog's slugs match the
 * renderer's glyph map (no drift), presets reference real techniques, and the
 * auto-fill defaults are well-formed.
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="construction-techniques"
 */
import {
  CONSTRUCTION_FAMILIES,
  CONSTRUCTION_TECHNIQUES,
  SUPPORTED_TECHNIQUES,
  defaultParamsFor,
  getTechnique,
} from "../../../../modules/designs/construction-techniques"
import { DETAIL_RENDERERS } from "../build-moodboard-scene"

describe("construction-techniques canonical catalog", () => {
  it("every technique has a renderer glyph (no triplication drift)", () => {
    for (const slug of SUPPORTED_TECHNIQUES) {
      expect(typeof DETAIL_RENDERERS[slug]).toBe("function")
    }
  })

  it("SUPPORTED_TECHNIQUES mirrors the catalog slugs", () => {
    expect([...SUPPORTED_TECHNIQUES].sort()).toEqual(
      CONSTRUCTION_TECHNIQUES.map((t) => t.slug).sort()
    )
  })

  it("every technique belongs to a known family", () => {
    for (const t of CONSTRUCTION_TECHNIQUES) {
      expect(CONSTRUCTION_FAMILIES).toContain(t.family)
    }
  })

  it("param defaults sit within [min,max] and auto-fill resolves them", () => {
    for (const t of CONSTRUCTION_TECHNIQUES) {
      const filled = defaultParamsFor(t.slug)
      for (const p of t.params) {
        expect(p.default).toBeGreaterThanOrEqual(p.min)
        expect(p.default).toBeLessThanOrEqual(p.max)
        expect(filled[p.key]).toBe(p.default)
      }
    }
  })

  it("presets reference valid param keys for their technique", () => {
    for (const t of CONSTRUCTION_TECHNIQUES) {
      const keys = new Set(t.params.map((p) => p.key))
      for (const preset of t.presets) {
        for (const k of Object.keys(preset.params ?? {})) {
          // Presets may carry cosmetic params (e.g. box-pleat count) the
          // renderer ignores — only assert known keys stay numeric.
          expect(typeof preset.params![k]).toBe("number")
          if (keys.size) {
            // when the technique has params, at least the declared ones exist
            expect(keys.has(k) || k === "count").toBe(true)
          }
        }
      }
    }
  })

  it("getTechnique returns undefined for unknown slugs", () => {
    expect(getTechnique("nope")).toBeUndefined()
  })
})
