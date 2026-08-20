import {
  boundSummaryInput,
  renderTranscript,
  MAX_MSG_CHARS,
  MAX_TOTAL_CHARS,
  type SummaryMessage,
} from "../bound-input"

const msg = (role: SummaryMessage["role"], text: string): SummaryMessage => ({
  role,
  parts: [{ type: "text", text }],
})

const textOf = (m: SummaryMessage) => m.parts.map((p) => p.text).join("\n")
const totalChars = (ms: SummaryMessage[]) =>
  ms.reduce((s, m) => s + textOf(m).length, 0)

describe("boundSummaryInput", () => {
  it("passes a small conversation through untouched", () => {
    const input = [
      msg("user", "hi"),
      msg("assistant", "hello"),
      msg("user", "update my product"),
    ]
    const out = boundSummaryInput(input)
    expect(out.map(textOf)).toEqual(["hi", "hello", "update my product"])
  })

  it("truncates a single pathological turn with a marker", () => {
    const huge = "x".repeat(MAX_MSG_CHARS + 5000)
    const out = boundSummaryInput([msg("user", "ctx"), msg("assistant", huge)])
    const big = textOf(out[1])
    expect(big.length).toBeLessThan(huge.length)
    expect(big).toMatch(/chars truncated/)
  })

  it("keeps total input within budget when the history is huge", () => {
    // 100 turns of 6k chars each = 600k, well over budget.
    const input: SummaryMessage[] = []
    for (let i = 0; i < 100; i++) {
      input.push(msg(i % 2 ? "assistant" : "user", `turn ${i} `.repeat(600)))
    }
    const out = boundSummaryInput(input)
    // A little slack for the omission marker.
    expect(totalChars(out)).toBeLessThanOrEqual(MAX_TOTAL_CHARS + 500)
  })

  it("preserves the FIRST turn — the store/task anchor — even when trimming", () => {
    const input: SummaryMessage[] = [
      msg("user", "store_01ANCHOR: work only in this store"),
    ]
    for (let i = 0; i < 60; i++) {
      input.push(msg(i % 2 ? "assistant" : "user", "y".repeat(3000)))
    }
    const out = boundSummaryInput(input)
    // The anchor survives at position 0.
    expect(textOf(out[0])).toContain("store_01ANCHOR")
  })

  it("keeps the most RECENT turn when trimming the middle", () => {
    const input: SummaryMessage[] = [msg("user", "anchor")]
    for (let i = 0; i < 60; i++) {
      input.push(msg(i % 2 ? "assistant" : "user", "z".repeat(3000)))
    }
    input.push(msg("user", "FINAL: publish it now"))
    const out = boundSummaryInput(input)
    expect(textOf(out[out.length - 1])).toContain("FINAL: publish it now")
  })

  it("notes the gap with an omission marker so history reads as non-continuous", () => {
    const input: SummaryMessage[] = [msg("user", "anchor")]
    for (let i = 0; i < 60; i++) {
      input.push(msg("assistant", "w".repeat(3000)))
    }
    const out = boundSummaryInput(input)
    expect(out.some((m) => /earlier turn\(s\) omitted/.test(textOf(m)))).toBe(
      true
    )
  })
})

describe("renderTranscript", () => {
  const msg = (role: SummaryMessage["role"], text: string): SummaryMessage => ({
    role,
    parts: [{ type: "text", text }],
  })

  it("labels each turn by speaker", () => {
    const t = renderTranscript([
      msg("user", "set the weight"),
      msg("assistant", "done"),
    ])
    expect(t).toBe("USER: set the weight\n\nASSISTANT: done")
  })

  it("renders the omission marker as a NOTE, not a USER turn", () => {
    // A system-role turn (the omission marker boundSummaryInput inserts) must
    // not read as a user turn — otherwise the model might answer it.
    const t = renderTranscript([msg("system", "[3 earlier turns omitted]")])
    expect(t).toBe("NOTE: [3 earlier turns omitted]")
  })

  it("produces a flat string with no trailing dangling question turn", () => {
    // The whole point: the transcript is DATA. Even when the last turn is a
    // question, it ends up inside the transcript body, and the route appends
    // the summarize instruction after it — so nothing dangles as the model's
    // turn to answer.
    const t = renderTranscript([
      msg("user", "hi"),
      msg("assistant", "hello"),
      msg("user", "what HS code?"),
    ])
    expect(t.endsWith("USER: what HS code?")).toBe(true)
    expect(typeof t).toBe("string")
  })
})
