/**
 * The wizard a partner sees is generated from the design's own spec. These
 * cover the things that make the answers usable: the same design always
 * produces the same wizard (or two partners' answers stop being comparable),
 * one question per thing a partner could answer differently, and never a
 * question with nothing in it.
 */
import {
  COLOUR_STEP,
  EVIDENCE_STEP,
  generateInquiryQuestions,
  resolveSpecVersion,
} from "../generate-questions"

const materialsRow = {
  id: "spec_1",
  category: "Materials",
  title: "Yarn",
  materials_required: ["Pashmina 80s", "Zari thread"],
  version: "v2",
}

const measurementsRow = {
  id: "spec_2",
  category: "Measurements",
  title: "Finished piece",
  measurements: { GSM: 80, Width: "70 cm" },
  version: "v2",
}

describe("generateInquiryQuestions", () => {
  it("asks one question per material rather than one per spec row", () => {
    // "I have the pashmina but not the zari" is the answer worth having, and a
    // single yes/no over the row would discard it.
    const questions = generateInquiryQuestions({ specifications: [materialsRow] })
    const prompts = questions.map((q) => q.prompt)

    expect(prompts).toContain("Can you supply Pashmina 80s?")
    expect(prompts).toContain("Can you supply Zari thread?")
    expect(questions.filter((q) => q.step === "Materials")).toHaveLength(2)
  })

  it("carries the target into a measurement question", () => {
    const questions = generateInquiryQuestions({
      specifications: [measurementsRow],
    })

    expect(questions.map((q) => q.prompt)).toContain(
      "What GSM can you achieve? (we need 80)"
    )
    expect(questions.find((q) => q.prompt.startsWith("What GSM"))?.kind).toBe(
      "number"
    )
  })

  it("orders steps canonically, whatever order the rows arrive in", () => {
    const forwards = generateInquiryQuestions({
      specifications: [materialsRow, measurementsRow],
    })
    const backwards = generateInquiryQuestions({
      specifications: [measurementsRow, materialsRow],
    })

    expect(backwards).toEqual(forwards)
    expect(forwards[0].step).toBe("Materials")
    expect(forwards.map((q) => q.order)).toEqual(
      forwards.map((_, index) => index)
    )
  })

  it("puts an unrecognised category last rather than dropping it", () => {
    const questions = generateInquiryQuestions({
      specifications: [
        { id: "spec_x", category: "Dyeing", title: "Azo-free only" },
        materialsRow,
      ],
    })

    const steps = questions.map((q) => q.step)
    expect(steps).toContain("Dyeing")
    expect(steps.indexOf("Dyeing")).toBeGreaterThan(steps.indexOf("Materials"))
  })

  it("falls back to the row itself when it names no materials or measurements", () => {
    const questions = generateInquiryQuestions({
      specifications: [
        { id: "spec_3", category: "Finishing", title: "Hand-rolled hem" },
      ],
    })

    expect(questions.map((q) => q.prompt)).toContain(
      "Can you do this: Hand-rolled hem?"
    )
  })

  it("asks NOTHING for a row that names nothing — an empty prompt is not a question", () => {
    const questions = generateInquiryQuestions({
      specifications: [
        { id: "spec_4", category: "Quality", title: "  ", materials_required: [] },
      ],
    })

    // Only the closing evidence question survives.
    expect(questions).toHaveLength(1)
    expect(questions[0].step).toBe(EVIDENCE_STEP)
  })

  it("skips blank material entries instead of asking about an empty name", () => {
    const questions = generateInquiryQuestions({
      specifications: [
        {
          id: "spec_5",
          category: "Materials",
          title: "Yarn",
          materials_required: ["Pashmina 80s", "", null, { name: "Silk warp" }],
        },
      ],
    })

    const materials = questions.filter((q) => q.step === "Materials")
    expect(materials.map((q) => q.prompt)).toEqual([
      "Can you supply Pashmina 80s?",
      "Can you supply Silk warp?",
    ])
  })

  it("renders the colour step with its hexes", () => {
    const questions = generateInquiryQuestions({
      specifications: [],
      colours: [
        { id: "optval_1", value: "Dusty Rose", hex: "#C08081" },
        { value: "  ", hex: "#000000" },
      ],
    })

    const colour = questions.find((q) => q.step === COLOUR_STEP)
    expect(colour?.kind).toBe("colour_select")
    expect(colour?.options).toEqual([
      { id: "optval_1", value: "Dusty Rose", hex: "#C08081" },
    ])
  })

  it("still asks for a photo when the design has no spec at all", () => {
    // The whole point of the exercise is seeing what is on their loom. A design
    // that has not been specced yet is exactly when that matters most.
    const questions = generateInquiryQuestions({ specifications: [] })

    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ step: EVIDENCE_STEP, kind: "photo" })
  })

  it("keeps the evidence question last even with a full spec", () => {
    const questions = generateInquiryQuestions({
      specifications: [materialsRow, measurementsRow],
      colours: [{ value: "Cream", hex: "#FFFDD0" }],
    })

    expect(questions[questions.length - 1].step).toBe(EVIDENCE_STEP)
  })

  it("restricts to the requested categories", () => {
    const questions = generateInquiryQuestions({
      specifications: [materialsRow, measurementsRow],
      categories: ["Materials"],
    })

    expect(questions.map((q) => q.step)).toEqual([
      "Materials",
      "Materials",
      EVIDENCE_STEP,
    ])
  })
})

describe("resolveSpecVersion", () => {
  it("returns the single version in play", () => {
    expect(resolveSpecVersion([materialsRow, measurementsRow])).toBe("v2")
  })

  it("names every version rather than picking one", () => {
    // Spec rows are approved separately, so more than one version is a real
    // state — and an answer must stay readable against what was actually asked.
    expect(
      resolveSpecVersion([materialsRow, { ...measurementsRow, version: "v3" }])
    ).toBe("v2, v3")
  })

  it("is null when nothing carries a version", () => {
    expect(resolveSpecVersion([{ id: "spec_9", category: "Other" }])).toBeNull()
    expect(resolveSpecVersion(null)).toBeNull()
  })
})
