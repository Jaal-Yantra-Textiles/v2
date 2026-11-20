import { describe, expect, it } from "vitest"
import { buildDesignChatBody, makeDesignChatBody, type DesignChatLive } from "../chat-request"

describe("design chat request body (#2543)", () => {
  it("sends the design id with its token", () => {
    const body = buildDesignChatBody({ prefs: { a: 1 }, designId: "des_1", designToken: "dt1.x", email: "a@b.co" }, "v1")
    expect(body).toEqual({
      visitor_id: "v1",
      prefs: { a: 1 },
      context: { design_id: "des_1", design_token: "dt1.x", email: "a@b.co" },
    })
  })

  it("never sends a token without its design id, and defaults the visitor", () => {
    const body = buildDesignChatBody({ prefs: null, designToken: "dt1.orphan" }, null)
    expect(body.context).toEqual({})
    expect(body.visitor_id).toBe("anonymous")
  })

  it("reads LIVE values per request (useChat keeps its first transport)", () => {
    // The transport is built once on first render, before any design exists.
    let live: DesignChatLive = { prefs: null }
    let visitor: string | null = null
    const body = makeDesignChatBody(() => live, () => visitor)
    expect(body().context).toEqual({})

    // Later: create_design hands the guest a design + token. The SAME body
    // function must now send them, or the next turn's tools refuse the design.
    live = { prefs: null, designId: "des_1", designToken: "dt1.x" }
    visitor = "v9"
    expect(body()).toMatchObject({
      visitor_id: "v9",
      context: { design_id: "des_1", design_token: "dt1.x" },
    })
  })

  it("sends new_piece only when '+ Another design' was pressed (#2556)", () => {
    expect(buildDesignChatBody({ prefs: null, newPiece: true }, "v").context).toEqual({
      new_piece: true,
    })
    expect(buildDesignChatBody({ prefs: null }, "v").context).toEqual({})
  })
})
