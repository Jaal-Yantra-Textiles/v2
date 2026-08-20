import {
  normaliseUiMessages,
  MAX_PART_TEXT_CHARS,
  MAX_TOTAL_TEXT_CHARS,
  TRUNCATION_MARKER,
} from "../assistant-messages"

const text = (t: string) => ({ type: "text", text: t })
const user = (t: string) => ({ role: "user", parts: [text(t)] })

describe("normaliseUiMessages — behaviour preserved", () => {
  it("flattens text parts and keeps role", () => {
    const { messages } = normaliseUiMessages([
      { role: "user", parts: [text("hello"), text("world")] },
    ])
    expect(messages).toEqual([
      { role: "user", parts: [text("hello"), text("world")] },
    ])
  })

  it("strips non-text parts (tool calls, files) from history", () => {
    const { messages } = normaliseUiMessages([
      {
        role: "assistant",
        parts: [
          { type: "tool-call", toolName: "create_product", input: { big: "x" } },
          text("done"),
          { type: "file", url: "https://example.com/a.png" },
        ],
      },
    ])
    expect(messages[0].parts).toEqual([text("done")])
  })

  it("falls back to `content` when there are no parts", () => {
    const { messages } = normaliseUiMessages([{ role: "user", content: "hi" }])
    expect(messages[0].parts).toEqual([text("hi")])
  })

  it("emits one empty text part when a message has nothing usable", () => {
    const { messages } = normaliseUiMessages([{ role: "user", parts: [] }])
    expect(messages[0].parts).toEqual([text("")])
  })

  it("reports bounded=false for an ordinary conversation", () => {
    const result = normaliseUiMessages([user("hi"), user("there")])
    expect(result.bounded).toBe(false)
    expect(result.droppedMessages).toBe(0)
    expect(result.truncatedParts).toBe(0)
  })

  it("tolerates null / undefined input", () => {
    expect(normaliseUiMessages(null).messages).toEqual([])
    expect(normaliseUiMessages(undefined).messages).toEqual([])
  })
})

describe("normaliseUiMessages — the bounds", () => {
  it("truncates a single oversized part and marks it", () => {
    const result = normaliseUiMessages([user("a".repeat(MAX_PART_TEXT_CHARS + 5_000))])
    const out = result.messages[0].parts[0].text
    expect(out.length).toBe(MAX_PART_TEXT_CHARS + TRUNCATION_MARKER.length)
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true)
    expect(result.truncatedParts).toBe(1)
    expect(result.bounded).toBe(true)
  })

  it("leaves a part exactly at the limit untouched", () => {
    const result = normaliseUiMessages([user("a".repeat(MAX_PART_TEXT_CHARS))])
    expect(result.messages[0].parts[0].text).not.toContain(TRUNCATION_MARKER)
    expect(result.bounded).toBe(false)
  })

  it("caps total retained text across the whole thread", () => {
    // 20 messages × 100k chars = 2M chars, well past the 600k budget.
    const thread = Array.from({ length: 20 }, () => user("a".repeat(100_000)))
    const result = normaliseUiMessages(thread)
    const total = result.messages.reduce(
      (sum, m) => sum + m.parts.reduce((s, p) => s + p.text.length, 0),
      0
    )
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_TEXT_CHARS)
    expect(result.droppedMessages).toBeGreaterThan(0)
    expect(result.bounded).toBe(true)
  })

  it("drops the OLDEST turns, never the newest — the newest is what's being answered", () => {
    // Each part stays UNDER the per-part cap so this exercises the thread
    // budget, not the truncator: 8 x 90k = 720k against a 600k budget.
    const thread = [
      user("oldest " + "a".repeat(90_000)),
      ...Array.from({ length: 6 }, () => user("filler " + "b".repeat(90_000))),
      user("NEWEST"),
    ]
    const { messages } = normaliseUiMessages(thread)
    const joined = messages.map((m) => m.parts[0].text).join("|")
    expect(joined).toContain("NEWEST")
    expect(joined).not.toContain("oldest")
  })

  it("preserves chronological order after trimming", () => {
    const thread = [
      ...Array.from({ length: 8 }, () => user("a".repeat(90_000))),
      user("SECOND"),
      user("THIRD"),
    ]
    const { messages } = normaliseUiMessages(thread)
    const kept = messages.map((m) => m.parts[0].text)
    expect(kept[kept.length - 1]).toBe("THIRD")
    expect(kept[kept.length - 2]).toBe("SECOND")
  })

  it("never returns an empty thread, even when the newest message alone busts the budget", () => {
    const result = normaliseUiMessages([user("z".repeat(MAX_TOTAL_TEXT_CHARS * 3))])
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].parts[0].text.length).toBeLessThanOrEqual(
      MAX_TOTAL_TEXT_CHARS + TRUNCATION_MARKER.length
    )
    expect(result.bounded).toBe(true)
  })

  it("bounds a 5 MB body — the size the route is willing to receive", () => {
    // What the route's bodyParser actually permits, spread over the 60-message
    // schema cap. Unbounded, all of this was retained and copied repeatedly.
    const thread = Array.from({ length: 60 }, (_, i) =>
      user(`turn ${i} ` + "x".repeat(87_000))
    )
    const result = normaliseUiMessages(thread)
    const total = result.messages.reduce(
      (sum, m) => sum + m.parts.reduce((s, p) => s + p.text.length, 0),
      0
    )
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_TEXT_CHARS)
    // And the turn the model must answer survived.
    const last = result.messages[result.messages.length - 1].parts[0].text
    expect(last.startsWith("turn 59 ")).toBe(true)
  })
})

/**
 * Drift guard.
 *
 * The bound landed on the partner assistant first and the admin assistant kept
 * its own byte-identical copy of the flattening step with no ceiling on it —
 * the same defect, live on a second surface, invisible to tsc and to every
 * other test. This asserts BOTH routes go through the shared helper, so a
 * future edit cannot quietly re-open the hole on one of them.
 *
 * Reads the sources as text on purpose: importing the routes drags in the
 * Medusa container, the MCP registries and the AI SDK.
 */
describe("both assistant surfaces use the shared bound", () => {
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")

  const ROUTES = [
    ["partner", "src/api/partners/assistant/chat/route.ts"],
    ["admin", "src/api/admin/assistant/chat/route.ts"],
  ] as const

  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8")

  it.each(ROUTES)("%s chat route imports normaliseUiMessages", (_name, rel) => {
    expect(read(rel)).toMatch(
      /import\s*\{\s*normaliseUiMessages\s*\}\s*from\s*".*lib\/assistant-messages"/
    )
  })

  it.each(ROUTES)(
    "%s chat route has no inline re-implementation of the flattening step",
    (_name, rel) => {
      // The signature of the old hand-rolled block. Its return shape
      // (`parts: textParts.length ? ... : ...`) is what made it unbounded.
      expect(read(rel)).not.toContain("textParts.length ? textParts")
    }
  )
})
