import { describe, expect, it } from "vitest"
import { collectBoardToolEvents, primeActivated } from "../board-refresh"

const tool = (type: string, id: string, output: Record<string, unknown> = {}, state = "output-available") => ({
  type: `tool-${type}`,
  toolCallId: id,
  state,
  output,
})
const assistant = (id: string, ...parts: unknown[]) => ({ id, role: "assistant", parts })
const text = (id: string, t: string) => assistant(id, { type: "text", text: t })

describe("collectBoardToolEvents (#2543 board refresh storm)", () => {
  it("refreshes once when a board tool completes", () => {
    const handled = new Set<string>()
    const msgs = [assistant("a1", tool("create_design", "c1", { design_id: "des_1", design_token: "dt1.x" }))]
    expect(collectBoardToolEvents(msgs, handled)).toEqual({
      createdId: "des_1",
      createdToken: "dt1.x",
      shouldRefresh: true,
      designs: [{ design_id: "des_1", design_token: "dt1.x" }],
    })
  })

  it("does NOT refresh again for the same finished tool on later streamed chunks", () => {
    const handled = new Set<string>()
    const history = [assistant("a1", tool("generate_design_image", "g1", { design_id: "des_1" }))]
    collectBoardToolEvents(history, handled)
    // 50 streamed chunks of a later reply: messages changes every time.
    let refreshes = 0
    for (let i = 0; i < 50; i++) {
      const msgs = [...history, text("a2", "x".repeat(i))]
      if (collectBoardToolEvents(msgs, handled).shouldRefresh) refreshes++
    }
    expect(refreshes).toBe(0)
  })

  it("refreshes again when a NEW board tool completes", () => {
    const handled = new Set<string>()
    const first = [assistant("a1", tool("create_design", "c1", { design_id: "des_1" }))]
    collectBoardToolEvents(first, handled)
    const next = [...first, assistant("a2", tool("save_moodboard", "m1"))]
    expect(collectBoardToolEvents(next, handled).shouldRefresh).toBe(true)
  })

  it("ignores tools that have not finished, and non-board tools", () => {
    const handled = new Set<string>()
    const msgs = [
      assistant("a1", tool("generate_design_image", "g1", {}, "input-available")),
      assistant("a2", tool("list_raw_materials", "r1", { materials: [] })),
    ]
    expect(collectBoardToolEvents(msgs, handled).shouldRefresh).toBe(false)
  })

  it("ignores user messages and keeps the latest minted design", () => {
    const handled = new Set<string>()
    const msgs = [
      { id: "u1", role: "user", parts: [tool("create_design", "fake", { design_id: "des_user" })] },
      assistant("a1", tool("create_design", "c1", { design_id: "des_1", design_token: "t1" })),
      assistant("a2", tool("generate_design_image", "g1", { design_id: "des_2", design_token: "t2" })),
    ]
    const ev = collectBoardToolEvents(msgs, handled)
    expect(ev.createdId).toBe("des_2")
    expect(ev.createdToken).toBe("t2")
  })

  // ── #2556: several designs ──
  it("start_new_design / switch_design / add_reference_link move the active design", () => {
    const handled = new Set<string>()
    const activated = new Set<string>()
    const msgs = [
      assistant("a1", tool("create_design", "c1", { design_id: "des_1", design_token: "t1" })),
      assistant("a2", tool("start_new_design", "s1", { design_id: "des_2", design_token: "t2", product_type: "trousers" })),
    ]
    const ev = collectBoardToolEvents(msgs, handled, activated)
    expect(ev.createdId).toBe("des_2")
    expect(ev.designs.map((d) => d.design_id)).toEqual(["des_1", "des_2"])
    expect(ev.designs[1].product_type).toBe("trousers")
  })

  it("🔴 a design the maker clicked stays active while the next reply streams", () => {
    const handled = new Set<string>()
    const activated = new Set<string>()
    const history = [assistant("a1", tool("start_new_design", "s1", { design_id: "des_2", design_token: "t2" }))]
    expect(collectBoardToolEvents(history, handled, activated).createdId).toBe("des_2")
    // Maker clicks the des_1 tab; a reply streams in — nothing may switch them back.
    const later = [...history, text("a2", "Sure, back on the kurta")]
    expect(collectBoardToolEvents(later, handled, activated).createdId).toBeNull()
  })

  it("a refused link (ok:false) activates nothing", () => {
    const ev = collectBoardToolEvents(
      [assistant("a1", tool("add_reference_link", "l1", { ok: false, message: "login wall" }))],
      new Set(),
      new Set()
    )
    expect(ev.createdId).toBeNull()
  })

  it("list_my_designs fills the tabs without changing the active design", () => {
    const ev = collectBoardToolEvents(
      [assistant("a1", tool("list_my_designs", "l1", { designs: [
        { design_id: "des_1", design_token: "t1", name: "Kurta" },
        { design_id: "des_2", design_token: "t2", name: "Trousers" },
      ] }))],
      new Set(),
      new Set()
    )
    expect(ev.createdId).toBeNull()
    expect(ev.designs.map((d) => d.name)).toEqual(["Kurta", "Trousers"])
  })

  it("primeActivated: a reload does not jump to the last activated design", () => {
    const activated = new Set<string>()
    const restored = [assistant("a1", tool("switch_design", "w1", { design_id: "des_2", design_token: "t2" }))]
    primeActivated(restored, activated)
    expect(collectBoardToolEvents(restored, new Set(), activated).createdId).toBeNull()
  })
})
