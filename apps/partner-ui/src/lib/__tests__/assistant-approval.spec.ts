import { describe, expect, it } from "vitest"

import {
  APPROVAL_NOTE_PREFIX,
  approvalNote,
  approvalNoteTool,
  resolveToolPart,
} from "../assistant-approval"

/** The shape a `requires_confirmation` turn actually has: the model explains,
 *  the tool call comes back unrun, and the model then asks for a confirmation
 *  the UI is already offering as a button. */
const confirmTurn = () => [
  { type: "text", text: "Here is what I'll create." },
  {
    type: "tool-create_product",
    toolCallId: "call_1",
    state: "output-available",
    input: { title: "Ikat grid" },
    output: { ok: false, tool: "create_product", requires_confirmation: true },
  },
  { type: "text", text: "Please confirm that you want me to proceed." },
]

describe("resolveToolPart", () => {
  it("writes the real result into the approved call", () => {
    const parts = resolveToolPart(
      confirmTurn(),
      "call_1",
      { ok: true, tool: "create_product", data: { id: "prod_1" } },
      "approved"
    )
    const call = parts.find((p) => p.toolCallId === "call_1") as any
    expect(call.output).toEqual({
      ok: true,
      tool: "create_product",
      data: { id: "prod_1" },
    })
    expect(call.output.requires_confirmation).toBeUndefined()
    expect(call.state).toBe("output-available")
  })

  it("drops the stale ask written after the card, keeping the lead-in", () => {
    const parts = resolveToolPart(confirmTurn(), "call_1", { ok: true }, "approved")
    const texts = parts.filter((p) => p.type === "text").map((p: any) => p.text)
    expect(texts).toEqual(["Here is what I'll create."])
  })

  it("keeps everything from a later tool call onwards", () => {
    const parts = resolveToolPart(
      [
        ...confirmTurn(),
        { type: "tool-list_products", toolCallId: "call_2", output: { ok: true } },
        { type: "text", text: "…and these are your products." },
      ],
      "call_1",
      { ok: true },
      "approved"
    )
    expect(parts.map((p) => p.type)).toEqual([
      "text",
      "tool-create_product",
      "tool-list_products",
      "text",
    ])
  })

  it("keeps the prose on cancel — nothing ran, so nothing it said is stale", () => {
    const parts = resolveToolPart(
      confirmTurn(),
      "call_1",
      { ok: false, cancelled: true, error: "Cancelled — nothing ran." },
      "rejected"
    )
    expect(parts).toHaveLength(3)
    expect((parts[2] as any).text).toBe(
      "Please confirm that you want me to proceed."
    )
    expect((parts[1] as any).output.cancelled).toBe(true)
  })

  it("leaves a message that doesn't hold the call untouched", () => {
    const parts = confirmTurn()
    expect(resolveToolPart(parts, "call_other", { ok: true }, "approved")).toBe(
      parts
    )
  })
})

describe("approvalNote", () => {
  it("names the tool and carries the result", () => {
    const note = approvalNote("create_product", { ok: true, data: { id: "p_1" } })
    expect(note.startsWith(APPROVAL_NOTE_PREFIX)).toBe(true)
    expect(note).toContain("`create_product`")
    expect(note).toContain('"id":"p_1"')
    expect(note).toContain("ALREADY RUN")
  })

  it("truncates a large result rather than blowing the context window", () => {
    const note = approvalNote("create_product", {
      data: { variants: Array.from({ length: 500 }, (_, i) => ({ id: `v_${i}` })) },
    })
    expect(note).toContain("(truncated)")
    expect(note.length).toBeLessThan(2400)
  })
})

describe("approvalNoteTool", () => {
  it("recognises an approval turn and reads back its tool", () => {
    expect(approvalNoteTool(approvalNote("delete_design", { ok: true }))).toBe(
      "delete_design"
    )
  })

  it("returns null for anything the partner actually typed", () => {
    expect(approvalNoteTool("please create the product")).toBeNull()
    expect(approvalNoteTool("")).toBeNull()
  })
})
