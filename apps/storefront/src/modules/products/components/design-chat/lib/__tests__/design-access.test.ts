import { describe, expect, it } from "vitest"

import {
  DESIGN_FORBIDDEN_MESSAGE,
  conversationTokenHeaders,
  describeChatError,
  describeDesignError,
  designTokenHeaders,
  isDesignForbiddenChatError,
  toDesignRequestError,
} from "../design-access"

describe("design access client helpers (#2543)", () => {
  it("sends the token headers only when there is a token", () => {
    expect(designTokenHeaders("dt1.a.b.c")).toEqual({ "x-design-token": "dt1.a.b.c" })
    expect(designTokenHeaders(null)).toEqual({})
    expect(conversationTokenHeaders("ct1.a.b")).toEqual({
      "x-conversation-token": "ct1.a.b",
    })
    expect(conversationTokenHeaders(undefined)).toEqual({})
  })

  it("maps 403 to the another-session copy and 429 to try-again-in-N-min", () => {
    expect(describeDesignError(403, "whatever", "x")).toBe(DESIGN_FORBIDDEN_MESSAGE)
    expect(
      describeDesignError(429, "Too many requests. Try again in 7 min.", "x")
    ).toBe("Too many requests — try again in 7 min.")
    expect(describeDesignError(500, "", "fallback")).toBe("fallback")
  })

  it("reads a sdk FetchError's status", () => {
    const err = toDesignRequestError({ status: 403, message: "nope" }, "x")
    expect(err.status).toBe(403)
    expect(err.message).toBe(DESIGN_FORBIDDEN_MESSAGE)
  })

  it("decodes the chat route's JSON error bodies", () => {
    const forbidden = new Error(
      JSON.stringify({ code: "design_access_denied", message: "This design belongs to another session." })
    )
    expect(describeChatError(forbidden)).toBe(DESIGN_FORBIDDEN_MESSAGE)
    expect(isDesignForbiddenChatError(forbidden)).toBe(true)

    const limited = new Error(
      JSON.stringify({ code: "rate_limited", message: "Too many requests. Try again in 3 min." })
    )
    expect(describeChatError(limited)).toBe("Too many requests — try again in 3 min.")
    expect(isDesignForbiddenChatError(limited)).toBe(false)

    expect(describeChatError(new Error("socket hang up"))).toBeNull()
    expect(describeChatError(undefined)).toBeNull()
  })
})
