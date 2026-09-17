import {
  buildGarmentState,
  GARMENT_TYPES,
  GARMENT_TYPE_CRITERIA,
  GARMENT_TYPE_INSTRUCTIONS,
  isGarmentType,
  NO_GARMENT_MATCH,
} from "../garment-types"
import { normalizeProductType } from "../product-type"

/**
 * The option list is the guard. Everything the old free-text prompt could only
 * ASK the model not to do, this makes unavailable.
 */
describe("the garment option list", () => {
  /**
   * 🔴 Not optional, and the reason is the old prompt's own words: "a model
   * asked to name a garment always names one". Without a no-match option the
   * model must pick a garment for a design that describes only fabric.
   */
  it("offers a no-match answer", () => {
    expect(GARMENT_TYPES).toContain(NO_GARMENT_MATCH)
    expect(GARMENT_TYPE_CRITERIA[NO_GARMENT_MATCH]).toBeTruthy()
  })

  /**
   * 🔑 Every option must survive `normalizeProductType` UNCHANGED.
   *
   * That function is still what writes the field, and it lowercases, strips
   * punctuation and joins on underscores. An option like "Cushion Cover" would
   * be stored as `cushion_cover` — so the list would no longer describe what is
   * in the database, and `isGarmentType` would reject the very value the
   * classifier had just produced.
   */
  it("stores every option verbatim through the normaliser", () => {
    for (const type of GARMENT_TYPES) {
      expect(normalizeProductType(type)).toBe(type)
    }
  })

  it("stays inside the 255-option limit System One accepts", () => {
    expect(GARMENT_TYPES.length).toBeLessThanOrEqual(255)
  })

  it("has no duplicate options", () => {
    expect(new Set(GARMENT_TYPES).size).toBe(GARMENT_TYPES.length)
  })

  /**
   * The vocabulary actually observed in the live catalogue — 155 items with a
   * description, mined this session. If a future edit drops one of these, the
   * classifier silently loses the ability to name the business's commonest
   * garment and answers `none_of_these` instead.
   */
  it("covers the garments the catalogue actually sells", () => {
    for (const observed of [
      "jacket",
      "shirt",
      "dress",
      "trousers",
      "top",
      "skirt",
      "jumpsuit",
      "shawl",
      "vest",
      "shorts",
      "sweater",
      "robe",
      "blouse",
      "tunic",
      "saree",
      "stole",
    ]) {
      expect(GARMENT_TYPES).toContain(observed)
    }
  })

  it("names the fabric-not-garment trap in its own criteria", () => {
    const criteria = GARMENT_TYPE_CRITERIA[NO_GARMENT_MATCH] as any
    expect(JSON.stringify(criteria).toLowerCase()).toContain("pashmina")
  })

  it("tells the model not to answer with a technique or a collection", () => {
    expect(GARMENT_TYPE_INSTRUCTIONS.toLowerCase()).toContain("never the fabric")
  })
})

describe("isGarmentType", () => {
  it("accepts an offered garment", () => {
    expect(isGarmentType("stole")).toBe(true)
  })

  /** The no-match answer is an answer, but it is not a type to store. */
  it("rejects the no-match answer", () => {
    expect(isGarmentType(NO_GARMENT_MATCH)).toBe(false)
  })

  it("rejects anything never offered", () => {
    expect(isGarmentType("pashmina")).toBe(false)
    expect(isGarmentType("handloom")).toBe(false)
    expect(isGarmentType("")).toBe(false)
    expect(isGarmentType(null)).toBe(false)
    expect(isGarmentType(undefined)).toBe(false)
  })

  /**
   * ⚠️ `in` on a plain object reaches Object.prototype. Without an own-property
   * guard, "constructor" and "toString" would both read as valid garments — and
   * `isGarmentType` is the check that decides whether an answer gets stored.
   */
  it("does not accept inherited object properties as garments", () => {
    expect(isGarmentType("constructor")).toBe(false)
    expect(isGarmentType("toString")).toBe(false)
    expect(isGarmentType("__proto__")).toBe(false)
  })
})

describe("buildGarmentState", () => {
  it("names each part instead of concatenating them", () => {
    expect(
      buildGarmentState({
        name: "Indigo Stole",
        description: "A long narrow wrap.",
        tags: ["indigo", "handwoven"],
        designer_notes: "For winter.",
      })
    ).toEqual({
      design: {
        name: "Indigo Stole",
        description: "A long narrow wrap.",
        tags: ["indigo", "handwoven"],
        designer_notes: "For winter.",
      },
    })
  })

  /**
   * 🔑 Absent, not empty. An empty description sent as `""` reads to the model
   * as a description that exists and says nothing, which is a different claim
   * from "this design has no description".
   */
  it("omits blank fields rather than sending empty strings", () => {
    const state = buildGarmentState({
      name: "Untitled",
      description: "   ",
      tags: [],
      designer_notes: null,
    }) as any

    expect(state.design.name).toBe("Untitled")
    expect("description" in state.design).toBe(true)
    expect(state.design.description).toBeUndefined()
    expect(state.design.tags).toBeUndefined()
    expect(state.design.designer_notes).toBeUndefined()
  })

  it("survives a design with nothing on it", () => {
    expect(buildGarmentState({})).toEqual({
      design: {
        name: undefined,
        description: undefined,
        tags: undefined,
        designer_notes: undefined,
      },
    })
  })
})
