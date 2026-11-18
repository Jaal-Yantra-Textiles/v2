import {
  activateDesign,
  MAX_DESIGNS_PER_CONVERSATION,
  runAddReferenceLink,
  runStartNewDesign,
  stripDesignTokens,
  summarizeDesign,
} from "../tools/storefront-design-multi"
import { createFixedWindowLimiter } from "../../../lib/design-access/rate-limits"
import type { DesignContext } from "../tools/storefront-design-flow"

// Paths below must refuse BEFORE the container is touched; a container that
// throws on any use proves they did.
const container: any = {
  resolve: () => {
    throw new Error("container must not be used on this path")
  },
}

describe("activateDesign", () => {
  it("makes the new design active and keeps the previous one, newest first", () => {
    const ctx: DesignContext = {
      design_id: "d1",
      design_token: "t1",
      designs: [{ design_id: "d0", design_token: "t0" }],
    }
    activateDesign(ctx, "d2", "t2")
    expect(ctx.design_id).toBe("d2")
    expect(ctx.design_token).toBe("t2")
    expect(ctx.designs).toEqual([
      { design_id: "d1", design_token: "t1" },
      { design_id: "d0", design_token: "t0" },
    ])
  })

  it("switching back does not duplicate the target in the list", () => {
    const ctx: DesignContext = {
      design_id: "d2",
      design_token: "t2",
      designs: [{ design_id: "d1", design_token: "t1" }],
    }
    activateDesign(ctx, "d1", "t1b")
    expect(ctx.design_id).toBe("d1")
    expect(ctx.designs).toEqual([{ design_id: "d2", design_token: "t2" }])
  })

  it(`caps the conversation at ${MAX_DESIGNS_PER_CONVERSATION} designs`, () => {
    const ctx: DesignContext = {
      design_id: "a",
      designs: Array.from({ length: 20 }, (_, i) => ({ design_id: `x${i}` })),
    }
    activateDesign(ctx, "new", "t")
    expect(1 + ctx.designs!.length).toBe(MAX_DESIGNS_PER_CONVERSATION)
  })
})

describe("stripDesignTokens", () => {
  it("🔴 removes nested tokens — the list tool returns one per design", () => {
    const out: any = stripDesignTokens({
      design_token: "top",
      designs: [{ design_id: "d1", design_token: "secret", name: "Kurta" }],
    })
    expect(JSON.stringify(out)).not.toMatch(/secret|top/)
    expect(out.designs[0]).toEqual({ design_id: "d1", name: "Kurta" })
  })
})

describe("summarizeDesign", () => {
  it("counts takes and references from the board", () => {
    const moodboard = {
      type: "excalidraw",
      elements: [
        { id: "a", type: "image", customData: { source: "canvas", canvas: { id: "c1", letter: "A", kind: "initial", active: true } } },
        { id: "b", type: "image", customData: { source: "canvas", canvas: { id: "c2", letter: "B", kind: "initial" } } },
        { id: "r", type: "image", customData: { source: "inspiration" } },
      ],
      files: {},
      appState: {},
    }
    const s = summarizeDesign({ id: "d1", name: "Kurta", product_type: "kurta", moodboard }, true)
    expect(s).toMatchObject({ takes: 2, references: 1, picked_take: "A", active: true, product_type: "kurta" })
  })
})

describe("start_new_design gates", () => {
  it("a guest is asked to verify, and nothing is created", async () => {
    const r: any = await runStartNewDesign(container, { product_type: "trousers" }, {})
    expect(r.sign_in_required).toBe(true)
  })

  it("refuses past the hourly limit before creating anything", async () => {
    const limiter = createFixedWindowLimiter({ windowMs: 60_000, max: 1 })
    limiter.hit("customer:cus_1")
    const r: any = await runStartNewDesign(container, {}, { customer_id: "cus_1" }, limiter)
    expect(r).toMatchObject({ ok: false })
    expect(r.message).toMatch(/Too many new designs/)
  })

  it("refuses a 13th design in one conversation", async () => {
    const ctx: DesignContext = {
      customer_id: "cus_1",
      design_id: "a",
      designs: Array.from({ length: MAX_DESIGNS_PER_CONVERSATION - 1 }, (_, i) => ({ design_id: `x${i}` })),
    }
    const r: any = await runStartNewDesign(container, {}, ctx)
    expect(r.message).toMatch(/already holds/)
  })
})

describe("add_reference_link gates", () => {
  it("a guest with no design is asked to verify — the link is not fetched", async () => {
    const fetcher = jest.fn()
    const r: any = await runAddReferenceLink(
      container,
      { url: "https://www.pinterest.com/pin/1/" },
      {},
      { fetcher }
    )
    expect(r.sign_in_required).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
