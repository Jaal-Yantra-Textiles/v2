import { choice, readSystemOneResult, typeSafeConfigured } from "../typesafe"

/**
 * The trust boundary between System One and anything that stores an answer.
 *
 * 🔴 `readSystemOneResult` is the whole point of this file. A bare cast would
 * let a 200 carrying an error envelope through as an answer whose `choice` is
 * `undefined` — and the caller would store it. That is the same failure shape
 * `model-json.ts` documents about `response.object || {}`: a model that did not
 * answer becoming a silently empty result.
 */
describe("readSystemOneResult", () => {
  const ok = {
    model: "jev-latest",
    answers: {
      garment: {
        type: "choice",
        choice: "stole",
        probabilities: { stole: 0.82, scarf: 0.1, shawl: 0.08 },
        confidence: 0.79,
      },
    },
    usage: { input_tokens: 312, output_tokens: 48 },
  }

  it("reads a well-formed answer", () => {
    const result = readSystemOneResult(ok)
    expect(result?.answers.garment.choice).toBe("stole")
    expect(result?.answers.garment.confidence).toBeCloseTo(0.79)
    expect(result?.answers.garment.probabilities.scarf).toBeCloseTo(0.1)
  })

  /**
   * 🔑 The case a truthiness guard gets wrong. A perfectly flat distribution
   * answers `confidence: 0`, and `!0` is true — so `if (!v.confidence) return
   * null` would reject exactly the answer a caller most needs to see, and the
   * total uncertainty would read as a transport failure.
   */
  it("keeps a confidence of exactly 0 — flat is an answer, not a failure", () => {
    const flat = {
      ...ok,
      answers: {
        garment: { ...ok.answers.garment, confidence: 0 },
      },
    }
    expect(readSystemOneResult(flat)?.answers.garment.confidence).toBe(0)
  })

  it("refuses an answer with no choice", () => {
    expect(
      readSystemOneResult({
        answers: { garment: { type: "choice", confidence: 0.9 } },
      })
    ).toBeNull()
  })

  it("refuses a confidence outside 0..1, and one that is not a number", () => {
    for (const confidence of [1.4, -0.2, "high", null, undefined, NaN]) {
      expect(
        readSystemOneResult({
          answers: { garment: { ...ok.answers.garment, confidence } },
        })
      ).toBeNull()
    }
  })

  /** A 200 carrying an error envelope must not read as an answer. */
  it("refuses a body with no answers at all", () => {
    expect(readSystemOneResult({ error: "rate limited" })).toBeNull()
    expect(readSystemOneResult({ answers: {} })).toBeNull()
    expect(readSystemOneResult(null)).toBeNull()
    expect(readSystemOneResult("not json")).toBeNull()
  })

  it("drops one unreadable answer but keeps a readable sibling", () => {
    const mixed = {
      answers: {
        garment: ok.answers.garment,
        broken: { type: "choice", choice: "", confidence: 0.5 },
      },
    }
    const result = readSystemOneResult(mixed)
    expect(Object.keys(result?.answers ?? {})).toEqual(["garment"])
  })

  it("survives missing probabilities rather than refusing the answer", () => {
    const noProbs = {
      answers: {
        garment: { type: "choice", choice: "stole", confidence: 0.7 },
      },
    }
    expect(readSystemOneResult(noProbs)?.answers.garment.probabilities).toEqual({})
  })
})

describe("choice", () => {
  it("shapes a question for the wire", () => {
    expect(choice("Which garment?", { stole: null })).toEqual({
      type: "choice",
      instructions: "Which garment?",
      criteria: { stole: null },
    })
  })
})

describe("typeSafeConfigured", () => {
  const original = process.env.TYPESAFE_API_KEY

  afterEach(() => {
    if (original === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = original
  })

  it("is false for missing, empty and whitespace keys", () => {
    delete process.env.TYPESAFE_API_KEY
    expect(typeSafeConfigured()).toBe(false)
    process.env.TYPESAFE_API_KEY = ""
    expect(typeSafeConfigured()).toBe(false)
    process.env.TYPESAFE_API_KEY = "   "
    expect(typeSafeConfigured()).toBe(false)
  })

  it("is true once a key is set", () => {
    process.env.TYPESAFE_API_KEY = "sk-test"
    expect(typeSafeConfigured()).toBe(true)
  })
})
