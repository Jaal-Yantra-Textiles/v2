import {
  CANCELLED_GATE,
  hasCancelledGate,
  patchCanvasClassify,
  patchClassifyCode,
  summarizePatch,
} from "../patch-cart-recovery-cancelled-gate-job"

/**
 * The gate this job edits is sandboxed JavaScript on a database row. A bad
 * insert does not fail a build or a test in prod — it runs hourly against
 * every abandoned cart on the platform and either skips everyone or nobody.
 * So the transform is pure and these assert the shape, not the formatting.
 */

/** The live body, as the seed script writes it. */
const CLASSIFY = `const send_items = []
const update_items = []
const counts = { already_reminded: 0 }

for (const cart of carts) {
  if (!cart || !cart.id) continue

  const md = cart.metadata || {}
  const sentCount = typeof md.recovery_email_count === "number" ? md.recovery_email_count : 0
  if (sentCount >= MAX_SENDS) {
    counts.already_reminded++
    continue
  }
  if (md.converted_order_id) {
    counts.converted = (counts.converted || 0) + 1
    continue
  }

  const items = Array.isArray(cart.items) ? cart.items : []
  if (items.length === 0) {
    counts.no_items++
    continue
  }
}

return { send_items, update_items, counts }`

describe("patchClassifyCode", () => {
  it("inserts the gate AFTER the converted block, not inside it", () => {
    const out = patchClassifyCode(CLASSIFY)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    const lines = out.code.split("\n")
    const convertedAt = lines.findIndex((l) => l.includes("md.converted_order_id"))
    const cancelledAt = lines.findIndex((l) => l.includes("md.cancelled_at"))
    const itemsAt = lines.findIndex((l) => l.includes("Array.isArray(cart.items)"))

    expect(convertedAt).toBeGreaterThan(-1)
    expect(cancelledAt).toBeGreaterThan(convertedAt)
    expect(cancelledAt).toBeLessThan(itemsAt)

    // The converted block's own `continue` must still be inside it: the line
    // directly before our insert closes that block.
    expect(lines[cancelledAt - 5].trim()).toBe("}")
  })

  it("keeps the rest of the body byte-identical", () => {
    const out = patchClassifyCode(CLASSIFY)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    /**
     * Remove the inserted RANGE, not every line whose text matches the gate.
     * The gate contains `continue` and `}`, which occur all over this body —
     * filtering by value deletes real code and compares two broken strings.
     */
    const gateLines = CANCELLED_GATE.replace(/\n$/, "").split("\n")
    const lines = out.code.split("\n")
    const start = lines.findIndex((l) => l === gateLines[0])
    expect(start).toBeGreaterThan(-1)
    expect(lines.slice(start, start + gateLines.length)).toEqual(gateLines)

    lines.splice(start, gateLines.length)
    expect(lines.join("\n")).toBe(CLASSIFY)
  })

  it("is IDEMPOTENT — a patched body is refused, not patched twice", () => {
    const once = patchClassifyCode(CLASSIFY)
    expect(once.ok).toBe(true)
    if (!once.ok) return

    const twice = patchClassifyCode(once.code)
    expect(twice).toEqual({ ok: false, reason: "already_patched" })
  })

  it("REFUSES a body without the anchor rather than guessing where to put it", () => {
    const foreign = `for (const cart of carts) {\n  doSomethingElse(cart)\n}`
    expect(patchClassifyCode(foreign)).toEqual({
      ok: false,
      reason: "anchor_missing",
    })
  })

  it("refuses an empty or non-string body", () => {
    expect(patchClassifyCode("")).toEqual({ ok: false, reason: "no_code" })
    expect(patchClassifyCode("   ")).toEqual({ ok: false, reason: "no_code" })
    expect(patchClassifyCode(null)).toEqual({ ok: false, reason: "no_code" })
    expect(patchClassifyCode(undefined)).toEqual({ ok: false, reason: "no_code" })
    expect(patchClassifyCode({ code: "x" })).toEqual({ ok: false, reason: "no_code" })
  })

  it("refuses when the anchor block is never closed", () => {
    const truncated = `for (const c of carts) {\n  if (md.converted_order_id) {\n    continue\n`
    expect(patchClassifyCode(truncated)).toEqual({
      ok: false,
      reason: "anchor_missing",
    })
  })

  it("matches the anchor's own indentation rather than assuming two spaces", () => {
    const deep = CLASSIFY.split("\n")
      .map((l) => (l ? `    ${l}` : l))
      .join("\n")
    const out = patchClassifyCode(deep)
    expect(out.ok).toBe(true)
  })
})

describe("hasCancelledGate", () => {
  it("detects the key, not the comment or the formatting", () => {
    expect(hasCancelledGate("if (md.cancelled_at) continue")).toBe(true)
    expect(hasCancelledGate("if(md.cancelled_at&&x){}")).toBe(true)
    expect(hasCancelledGate(CLASSIFY)).toBe(false)
    expect(hasCancelledGate("")).toBe(false)
  })

  it("is not fooled by a similarly named key", () => {
    expect(hasCancelledGate("md.cancelled_reason")).toBe(false)
  })
})

describe("summarizePatch", () => {
  it("says WOULD on a preview and did on an apply", () => {
    const ok = { ok: true as const, code: "x" }
    expect(summarizePatch(true, ok)).toMatch(/Would add/)
    expect(summarizePatch(false, ok)).toMatch(/^Added/)
  })

  it("names the refusal so an operator knows not to retry", () => {
    expect(
      summarizePatch(true, { ok: false, reason: "anchor_missing" })
    ).toMatch(/REFUSED/)
    expect(
      summarizePatch(true, { ok: false, reason: "already_patched" })
    ).toMatch(/Already patched/)
  })
})

/**
 * 🔴 2026-10-28: the operation row was patched, the canvas copy was not, and
 * the canvas copy is what the executor runs — Cherry's cancelled design order
 * was mailed anyway. The canvas node must be patched too.
 */
describe("patchCanvasClassify", () => {
  const canvas = (code: string | undefined) => ({
    viewport: { x: 0, y: 0, zoom: 1 },
    edges: [{ source: "read_carts", target: "classify" }],
    nodes: [
      { id: "trigger", data: {} },
      { id: "read_carts", data: { options: { entity: "cart" } } },
      {
        id: "classify",
        data: { operationKey: "classify", options: { code, timeout: 5000 } },
      },
    ],
  })

  it("patches the canvas classify node and leaves every other node and key alone", () => {
    const before = canvas(CLASSIFY)
    const out = patchCanvasClassify(before)
    if (!out.ok) throw new Error(`expected ok, got ${out.reason}`)

    expect(out.node_id).toBe("classify")
    expect(hasCancelledGate(out.after)).toBe(true)
    const node = out.canvas_state.nodes.find((n: any) => n.id === "classify")
    expect(node.data.options).toEqual({ code: out.after, timeout: 5000 })
    expect(out.canvas_state.nodes[1]).toEqual(before.nodes[1])
    expect(out.canvas_state.edges).toEqual(before.edges)
    expect(out.canvas_state.viewport).toEqual(before.viewport)
    // The input is not mutated.
    expect(hasCancelledGate(String(before.nodes[2].data.options?.code))).toBe(false)
  })

  it("is idempotent on a canvas that already carries the gate", () => {
    const patched = patchClassifyCode(CLASSIFY)
    if (!patched.ok) throw new Error("setup")
    expect(patchCanvasClassify(canvas(patched.code))).toEqual({
      ok: false,
      reason: "already_patched",
    })
  })

  it("reports no canvas node when the flow runs from its operation rows", () => {
    expect(patchCanvasClassify({ nodes: [] })).toEqual({ ok: false, reason: "no_canvas_node" })
    expect(patchCanvasClassify(null)).toEqual({ ok: false, reason: "no_canvas_node" })
    expect(patchCanvasClassify(canvas(undefined))).toEqual({ ok: false, reason: "no_canvas_node" })
  })
})
