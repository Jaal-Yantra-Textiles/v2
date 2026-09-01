import { describe, expect, it } from "vitest"
import {
  INCOMPLETE_TOOL_ERROR,
  countPendingToolParts,
  sealPendingToolParts,
} from "../incomplete-turn"

/**
 * Both fixtures are the real shapes measured on production on 2026-09-02 by
 * replaying a design turn through cicilabel.com/api/ai-chat and recording the
 * SSE parts. Kept ugly on purpose: a tidier fixture would certify the wrong
 * code.
 */

// Run A — `save_brief` announced at 2.12s and abandoned; `create_design` and
// `capture_contact` both ran; the stream was then cut mid-word at 10.53s with
// no `text-end` and no `finish`. The prose still claimed the brief was locked.
const runA = {
  id: "msg-a",
  role: "assistant",
  parts: [
    {
      type: "tool-save_brief",
      toolCallId: "call_80209fa86fea456d81fe12",
      state: "input-streaming",
      input: { product_type: "jumpsuit", concept_theme: "Relaxed indigo" },
    },
    {
      type: "tool-create_design",
      toolCallId: "call_d6433877c41946ba955ad5",
      state: "output-available",
      input: { email: "maker@example.com", name: "Probe 1725" },
      output: { design_id: "design_01ABC" },
    },
    {
      type: "tool-capture_contact",
      toolCallId: "call_d0e8333afa4d466b89f6a1",
      state: "output-available",
      input: { email: "maker@example.com" },
      output: { ok: true },
    },
    {
      type: "text",
      text: "✅ Brief locked and design created!  \nYour design is now live — These will directly",
    },
  ],
}

// Run B — both tool calls announced, neither ever reached
// `tool-input-available`, and the turn closed with `finishReason: "tool-calls"`
// and no text at all. Two chips spinning, nothing said.
const runB = {
  id: "msg-b",
  role: "assistant",
  parts: [
    {
      type: "tool-save_brief",
      toolCallId: "call_dd1f22a953e641348931d4",
      state: "input-streaming",
      input: undefined,
    },
    {
      type: "tool-create_design",
      toolCallId: "call_010ba7f58de646e4b6649d",
      state: "input-streaming",
      input: undefined,
    },
  ],
}

const healthy = {
  id: "msg-ok",
  role: "assistant",
  parts: [
    {
      type: "tool-save_brief",
      state: "output-available",
      output: { ok: true },
    },
    { type: "text", text: "Brief locked." },
  ],
}

describe("countPendingToolParts", () => {
  it("counts the abandoned call in a partially-executed turn", () => {
    expect(countPendingToolParts(runA)).toBe(1)
  })

  it("counts every call in a turn where none executed", () => {
    expect(countPendingToolParts(runB)).toBe(2)
  })

  it("counts nothing in a completed turn", () => {
    expect(countPendingToolParts(healthy)).toBe(0)
  })

  it("treats input-available as pending — arguments complete is not a result", () => {
    expect(
      countPendingToolParts({
        parts: [{ type: "tool-save_brief", state: "input-available" }],
      })
    ).toBe(1)
  })

  it("ignores non-tool parts in the same states", () => {
    expect(
      countPendingToolParts({
        parts: [{ type: "text", state: "input-streaming", text: "hi" }],
      })
    ).toBe(0)
  })
})

describe("sealPendingToolParts", () => {
  it("marks the abandoned call failed and leaves the executed ones alone", () => {
    const sealed: any = sealPendingToolParts(runA)

    expect(sealed.parts[0].state).toBe("output-error")
    expect(sealed.parts[0].errorText).toBe(INCOMPLETE_TOOL_ERROR)
    // The two that really ran keep their results — sealing is not a reset.
    expect(sealed.parts[1].state).toBe("output-available")
    expect(sealed.parts[1].output).toEqual({ design_id: "design_01ABC" })
    expect(sealed.parts[2].state).toBe("output-available")
    // The truncated prose is left as the model wrote it; the chip is what
    // tells the maker it was not true.
    expect(sealed.parts[3]).toEqual(runA.parts[3])
    expect(countPendingToolParts(sealed)).toBe(0)
  })

  it("marks every call failed when none executed", () => {
    const sealed: any = sealPendingToolParts(runB)

    expect(sealed.parts.map((p: any) => p.state)).toEqual([
      "output-error",
      "output-error",
    ])
    expect(countPendingToolParts(sealed)).toBe(0)
  })

  it("does not touch a completed turn", () => {
    expect(sealPendingToolParts(healthy)).toBe(healthy)
  })

  it("does not mutate the message it was given", () => {
    sealPendingToolParts(runB)
    expect(runB.parts[0].state).toBe("input-streaming")
  })
})
