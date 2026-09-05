import { describeChatError } from "../chat-error"

/**
 * Every string here is one a real runtime produces. The reported symptom was
 * an operator being shown, as the entire explanation, the word Safari uses for
 * any failed fetch: "Load failed".
 */
describe("describeChatError", () => {
  it("does not show a browser's raw 'Load failed' as the explanation", () => {
    const advice = describeChatError(new Error("Load failed"))

    expect(advice.title).not.toMatch(/^Load failed$/i)
    expect(advice.title).toMatch(/couldn't reach the server/i)
    expect(advice.retryable).toBe(true)
  })

  it("recognises each browser's own words for a dead fetch", () => {
    for (const raw of [
      "Load failed",
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "The network connection was lost.",
      "socket hang up",
    ]) {
      expect(describeChatError(new Error(raw)).title).toMatch(
        /couldn't reach the server/i
      )
    }
  })

  /**
   * A gateway timeout reaches the browser as a failed fetch too — and "check
   * your connection" is the wrong advice for a connection that worked fine.
   * It was the answer that never came.
   */
  it("calls a gateway timeout busy, not disconnected", () => {
    for (const raw of [
      "Route responded 504: gateway time-out",
      "504 Gateway Timeout",
      "The operation was aborted",
      "ETIMEDOUT",
    ]) {
      const advice = describeChatError(new Error(raw))
      expect(advice.title).toMatch(/busy|too long/i)
      expect(advice.title).not.toMatch(/couldn't reach/i)
      expect(advice.retryable).toBe(true)
    }
  })

  it("still separates the faults retrying cannot fix", () => {
    expect(describeChatError(new Error("401 unauthorized")).retryable).toBe(false)
    expect(describeChatError(new Error("503 not configured")).retryable).toBe(false)
    expect(describeChatError(new Error("429 rate limit")).retryable).toBe(true)
  })

  it("keeps an unknown message as a clue, never as the whole answer", () => {
    const advice = describeChatError(new Error("something exotic"))

    expect(advice.title).toMatch(/hit an error/i)
    expect(advice.detail).toMatch(/try again/i)
    expect(advice.detail).toContain("something exotic")
  })

  it("says something useful when there is no message at all", () => {
    const advice = describeChatError({})

    expect(advice.title).toBeTruthy()
    expect(advice.detail).toMatch(/try again/i)
  })
})
