import { summarizeAiStepError } from "../image-extraction"

/**
 * #769 — the image-extraction step used to swallow the real provider failure as
 * a generic "Mastra image extraction workflow failed". These fixtures are the
 * actual error shapes seen in prod CloudWatch, asserting the operator now gets
 * the real reason.
 */
describe("summarizeAiStepError", () => {
  it("digs the nested Cloudflare AiError reason out of responseBody", () => {
    // Real shape: AI SDK APICallError wrapping Cloudflare's double-nested AiError.
    const err = {
      statusCode: 400,
      responseBody: JSON.stringify({
        errors: [
          {
            message:
              'AiError: AiError: {"error":{"message":"Failed to load image: cannot identify image file <_io.BytesIO object>","type":"BadRequestError","code":400}} (abc-123)',
            code: 8007,
          },
        ],
        success: false,
      }),
    }
    const msg = summarizeAiStepError(err)
    expect(msg).toContain("HTTP 400")
    expect(msg).toContain("cannot identify image file")
    // The generic wrapper text must NOT be what surfaces.
    expect(msg).not.toMatch(/workflow failed/i)
  })

  it("surfaces an authentication error from responseBody", () => {
    const err = {
      statusCode: 401,
      responseBody: JSON.stringify({
        success: false,
        errors: [{ code: 10000, message: "Authentication error" }],
      }),
    }
    const msg = summarizeAiStepError(err)
    expect(msg).toBe("HTTP 401: Authentication error")
  })

  it("handles OpenAI-style error.message shape", () => {
    const err = {
      statusCode: 400,
      responseBody: JSON.stringify({
        error: { message: "Unable to process input image", code: "invalid" },
      }),
    }
    expect(summarizeAiStepError(err)).toBe("HTTP 400: Unable to process input image")
  })

  it("falls back to the raw responseBody snippet when not parseable", () => {
    const err = { statusCode: 502, responseBody: "<html>Bad Gateway</html>" }
    const msg = summarizeAiStepError(err)
    expect(msg).toContain("HTTP 502")
    expect(msg).toContain("Bad Gateway")
  })

  it("uses describeFetchError for undici network failures (no responseBody)", () => {
    const err: any = new Error("fetch failed")
    err.cause = { code: "ENOTFOUND", hostname: "api.cloudflare.com", syscall: "getaddrinfo" }
    const msg = summarizeAiStepError(err)
    expect(msg).toMatch(/ENOTFOUND|api\.cloudflare\.com|fetch failed/)
  })

  it("handles a plain string error and a bare Error", () => {
    expect(summarizeAiStepError("boom")).toContain("boom")
    expect(summarizeAiStepError(new Error("something broke"))).toContain("something broke")
  })

  it("caps the message length", () => {
    const err = { statusCode: 400, responseBody: "x".repeat(5000) }
    expect(summarizeAiStepError(err).length).toBeLessThanOrEqual(500)
  })
})
