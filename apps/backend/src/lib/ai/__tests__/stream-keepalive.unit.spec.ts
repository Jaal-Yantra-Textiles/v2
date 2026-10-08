import { EventEmitter } from "events"
import { keepStreamAlive } from "../stream-keepalive"

const fakeRes = () => {
  const ee = new EventEmitter() as any
  ee.headersSent = true
  ee.writableEnded = false
  ee.writes = [] as string[]
  ee.write = (c: string) => {
    ee.writes.push(c)
    return true
  }
  return ee
}

describe("keepStreamAlive", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it("writes an SSE comment every interval while the stream is open", () => {
    const res = fakeRes()
    keepStreamAlive(res, 15_000)
    jest.advanceTimersByTime(45_000)
    expect(res.writes).toEqual([": keep-alive\n\n", ": keep-alive\n\n", ": keep-alive\n\n"])
  })

  it("stops when the response finishes or the client goes away", () => {
    const res = fakeRes()
    keepStreamAlive(res, 15_000)
    jest.advanceTimersByTime(15_000)
    res.emit("close")
    jest.advanceTimersByTime(60_000)
    expect(res.writes).toHaveLength(1)
  })

  it("never writes before the headers are out, or after the end", () => {
    const res = fakeRes()
    res.headersSent = false
    keepStreamAlive(res, 15_000)
    jest.advanceTimersByTime(15_000)
    expect(res.writes).toHaveLength(0)
    res.headersSent = true
    res.writableEnded = true
    jest.advanceTimersByTime(30_000)
    expect(res.writes).toHaveLength(0)
  })

  it("is skipped by the AI SDK's own event-stream parser (what the chat client uses)", async () => {
    const { parseJsonEventStream, jsonSchema } = await import("ai")
    const bytes = new TextEncoder().encode(
      'data: {"type":"start"}\n\n' + ": keep-alive\n\n" + 'data: {"type":"finish"}\n\n'
    )
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes)
        c.close()
      },
    })
    const parsed = parseJsonEventStream({ stream: source, schema: jsonSchema<any>({}) })
    const events: any[] = []
    for await (const e of parsed as any) events.push(e.success ? e.value : e)
    expect(events).toEqual([{ type: "start" }, { type: "finish" }])
  })
})
