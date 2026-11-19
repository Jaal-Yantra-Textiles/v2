import { readUIMessageStream, type UIMessageChunk } from "ai"
import { startedPieceNote, startedPieceUIStream } from "../new-piece-lib"

// #2556: the route starts "the matching trousers" itself; the page must get it
// as an ordinary, finished start_new_design tool part — that is what makes the
// tab (board-refresh.ts reads tool-start_new_design output.design_id/token).
const started = {
  design_id: "01M7TROUSERS0000000000000AA",
  design_token: "dt1.01M7TROUSERS0000000000000AA.cus_1.sig",
  name: "Trousers",
  product_type: "trousers",
  previous_design_id: "01M7RRA9XAFNZE94DNGHEGZHDZ",
  open_designs: 2,
}

/** Stands in for streamText's result: a reply with one text part. */
const fakeModelReply = (text: string) => ({
  toUIMessageStream: (opts?: { sendStart?: boolean }) =>
    new ReadableStream<UIMessageChunk>({
      start(controller) {
        if (opts?.sendStart !== false) controller.enqueue({ type: "start" })
        controller.enqueue({ type: "start-step" })
        controller.enqueue({ type: "text-start", id: "t1" })
        controller.enqueue({ type: "text-delta", id: "t1", delta: text })
        controller.enqueue({ type: "text-end", id: "t1" })
        controller.enqueue({ type: "finish-step" })
        controller.enqueue({ type: "finish" })
        controller.close()
      },
    }),
})

const lastMessage = async (stream: ReadableStream<UIMessageChunk>) => {
  let last: any = null
  for await (const m of readUIMessageStream({ stream })) last = m
  return last
}

describe("startedPieceUIStream", () => {
  it("puts the started design first, as a finished start_new_design part, then the reply", async () => {
    const message = await lastMessage(
      startedPieceUIStream(fakeModelReply("Your trousers are started."), started, () => "err")
    )
    const parts = message.parts.filter((p: any) => p.type !== "step-start")
    expect(parts.map((p: any) => p.type)).toEqual(["tool-start_new_design", "text"])
    expect(parts[0]).toMatchObject({
      state: "output-available",
      output: { design_id: started.design_id, design_token: started.design_token },
    })
    expect(parts[1].text).toBe("Your trousers are started.")
  })

  it("sends exactly one start (the page would otherwise begin a second message)", async () => {
    const chunks: UIMessageChunk[] = []
    const reader = startedPieceUIStream(fakeModelReply("ok"), started, () => "err").getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    expect(chunks.filter((c) => c.type === "start")).toHaveLength(1)
  })
})

describe("startedPieceNote", () => {
  it("tells the model the piece exists and not to start or create it again", () => {
    const note = startedPieceNote(started)
    expect(note).toMatch(/for the trousers/)
    expect(note).toMatch(/Do NOT call start_new_design or create_design/)
    expect(note).not.toContain(started.design_id)
  })
})
