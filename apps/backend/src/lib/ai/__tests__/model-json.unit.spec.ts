import {
  extractJsonBlock,
  readModelJson,
  readModelJsonOrThrow,
} from "../model-json"

describe("extractJsonBlock", () => {
  it("finds bare and fenced JSON", () => {
    expect(extractJsonBlock('{"a":1}')).toBe('{"a":1}')
    expect(extractJsonBlock('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJsonBlock('Here you go: {"a":1} — hope that helps')).toBe('{"a":1}')
  })

  it("matches the CLOSING brace, so a nested object is not truncated", () => {
    // The lazy /\{[\s\S]*?\}/ that textileProductExtraction used stops at the
    // first "}", producing invalid JSON on any nested response.
    const text = '{"title":"x","meta":{"a":1},"n":2}'
    expect(extractJsonBlock(text)).toBe(text)
    expect(JSON.parse(extractJsonBlock(text)!)).toEqual({
      title: "x",
      meta: { a: 1 },
      n: 2,
    })
  })

  it("ignores braces inside string literals", () => {
    // A reasoning field mentioning "}" must not close the object early.
    const text = '{"reasoning":"use {curly} braces","ok":true}'
    expect(JSON.parse(extractJsonBlock(text)!)).toEqual({
      reasoning: "use {curly} braces",
      ok: true,
    })
  })

  it("ignores an escaped quote inside a string", () => {
    const text = '{"q":"he said \\"hi\\" }","ok":true}'
    expect(JSON.parse(extractJsonBlock(text)!)).toEqual({
      q: 'he said "hi" }',
      ok: true,
    })
  })

  it("finds a top-level array", () => {
    expect(extractJsonBlock('[{"a":1},{"b":2}]')).toBe('[{"a":1},{"b":2}]')
  })

  it("returns null when there is nothing to find", () => {
    expect(extractJsonBlock("")).toBeNull()
    expect(extractJsonBlock("no json here")).toBeNull()
    expect(extractJsonBlock("{ unterminated")).toBeNull()
    expect(extractJsonBlock(null as any)).toBeNull()
  })
})

describe("readModelJson", () => {
  it("prefers a structured object", () => {
    expect(readModelJson({ object: { a: 1 } })).toEqual({ a: 1 })
  })

  it("falls back to the text — the shape that broke this in real life", () => {
    // stealth/ox-alpha returned a correct answer as prose with `object`
    // undefined. Everything reading `.object` threw.
    expect(
      readModelJson({
        object: undefined,
        text: 'Sure!\n```json\n{"title":"Handloom stole"}\n```',
      })
    ).toEqual({ title: "Handloom stole" })
  })

  it("returns null rather than an empty object when nothing is readable", () => {
    // `response.object || {}` turns a prose answer into a silently empty
    // extraction, which reads downstream as "the model found nothing".
    expect(readModelJson({ text: "I could not do that" })).toBeNull()
    expect(readModelJson({})).toBeNull()
    expect(readModelJson({ object: "a string" })).toBeNull()
  })
})

describe("readModelJsonOrThrow", () => {
  it("returns the value when there is one", () => {
    expect(readModelJsonOrThrow({ object: { a: 1 } }, "ctx")).toEqual({ a: 1 })
  })

  it("throws with the model's own words so the failure is diagnosable", () => {
    expect(() =>
      readModelJsonOrThrow({ text: "I refuse to answer that" }, "designValidator")
    ).toThrow(/designValidator.*I refuse to answer that/s)
  })

  it("says (empty) rather than nothing when the model returned no text", () => {
    expect(() => readModelJsonOrThrow({}, "seo")).toThrow(/\(empty\)/)
  })
})
