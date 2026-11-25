import { patchCanvasClassify, patchClassifyCode } from "../patch-cart-recovery-cancelled-gate-job"
import { DESIGN_ORDER_SKIP_GATE } from "../patch-cart-recovery-skip-design-orders-job"

const LIVE = `for (const cart of records) {
  const md = cart.metadata || {}
  if (md.converted_order_id) {
    counts.converted = (counts.converted || 0) + 1
    continue
  }
  if (typeof md.cancelled_at === "string" && md.cancelled_at.trim()) {
    counts.cancelled = (counts.cancelled || 0) + 1
    continue
  }
  send_items.push(cart.id)
}`

describe("design-order skip gate", () => {
  it("inserts the skip right after the converted block, before anything is queued", () => {
    const out = patchClassifyCode(LIVE, DESIGN_ORDER_SKIP_GATE)
    expect(out.ok).toBe(true)
    const code = (out as any).code as string
    expect(code.indexOf('md.source === "design-order"')).toBeGreaterThan(code.indexOf("md.converted_order_id"))
    expect(code.indexOf('md.source === "design-order"')).toBeLessThan(code.indexOf("send_items.push"))
    // The cancelled gate is untouched.
    expect(code).toContain("md.cancelled_at.trim()")
    // And the result still runs: a design-order cart is skipped, a storefront one is queued.
    const run = new Function("records", "counts", "send_items", code)
    const counts: any = {}
    const sent: string[] = []
    run([{ id: "d", metadata: { source: "design-order" } }, { id: "s", metadata: {} }], counts, sent)
    expect(sent).toEqual(["s"])
    expect(counts.design_order).toBe(1)
  })

  it("is idempotent", () => {
    const once = (patchClassifyCode(LIVE, DESIGN_ORDER_SKIP_GATE) as any).code
    expect(patchClassifyCode(once, DESIGN_ORDER_SKIP_GATE)).toEqual({ ok: false, reason: "already_patched" })
  })

  it("patches the canvas copy, which is what runs", () => {
    const canvas = { nodes: [{ id: "classify", data: { operationKey: "classify", options: { code: LIVE } } }] }
    const out = patchCanvasClassify(canvas, DESIGN_ORDER_SKIP_GATE)
    expect(out.ok).toBe(true)
    expect((out as any).canvas_state.nodes[0].data.options.code).toContain('md.source === "design-order"')
  })
})
