import { describe, expect, it } from "vitest"
import { toClientHeaders } from "../proxy-headers"

describe("toClientHeaders (#2543 invisible 403/429)", () => {
  it("drops content-encoding and content-length that fetch already undid", () => {
    const out = toClientHeaders(
      new Headers({
        "content-encoding": "gzip",
        "content-length": "123",
        "content-type": "application/json",
        "retry-after": "120",
      })
    )
    expect(out.get("content-encoding")).toBeNull()
    expect(out.get("content-length")).toBeNull()
    expect(out.get("content-type")).toBe("application/json")
    expect(out.get("retry-after")).toBe("120")
  })

  it("keeps the SSE stream headers intact", () => {
    const out = toClientHeaders(new Headers({ "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" }))
    expect(out.get("content-type")).toBe("text/event-stream")
    expect(out.get("x-vercel-ai-ui-message-stream")).toBe("v1")
  })

  it("does not mutate the upstream headers", () => {
    const up = new Headers({ "content-encoding": "br" })
    toClientHeaders(up)
    expect(up.get("content-encoding")).toBe("br")
  })
})
