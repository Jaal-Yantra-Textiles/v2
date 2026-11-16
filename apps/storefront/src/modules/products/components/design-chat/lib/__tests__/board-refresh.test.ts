import { describe, expect, it } from "vitest"
import { collectBoardToolEvents } from "../board-refresh"

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
})
