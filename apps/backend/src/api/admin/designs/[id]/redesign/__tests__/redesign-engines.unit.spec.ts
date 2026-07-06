/**
 * Unit tests — redesign-engines (#892). Only the pure/parsing surface; the network
 * calls (OpenRouter / Google) are exercised by smoke tests, not here.
 *
 * Run: TEST_TYPE=unit npx jest --testPathPattern="redesign-engines"
 */
import {
  parseImageToInlineData,
  classifyProviderError,
  RedesignEngineError,
} from "../redesign-engines"

describe("parseImageToInlineData", () => {
  it("splits a base64 data URL into mimeType + data without a network call", async () => {
    const out = await parseImageToInlineData("data:image/webp;base64,AABBCC")
    expect(out).toEqual({ mimeType: "image/webp", data: "AABBCC" })
  })

  it("throws bad_input on a non-base64 data URL", async () => {
    await expect(parseImageToInlineData("data:image/png,notbase64")).rejects.toMatchObject(
      { kind: "bad_input", status: 400 }
    )
  })

  it("rejects a non-image data URL", async () => {
    await expect(
      parseImageToInlineData("data:application/pdf;base64,AAAA")
    ).rejects.toMatchObject({ kind: "bad_input" })
  })
})

describe("classifyProviderError", () => {
  it("maps 429 / quota wording to rate_limit (429)", () => {
    for (const err of [
      { statusCode: 429, message: "Too Many Requests" },
      { message: "You exceeded your current quota" },
      { message: "rate limit reached for model" },
    ]) {
      const e = classifyProviderError(err, "openrouter")
      expect(e).toBeInstanceOf(RedesignEngineError)
      expect(e.kind).toBe("rate_limit")
      expect(e.status).toBe(429)
    }
  })

  it("maps 401/403 / auth wording to auth (502)", () => {
    for (const err of [
      { status: 401, message: "Unauthorized" },
      { statusCode: 403, message: "Forbidden" },
      { message: "invalid api key provided" },
    ]) {
      const e = classifyProviderError(err, "google")
      expect(e.kind).toBe("auth")
    }
  })

  it("falls back to provider (502) for anything else", () => {
    const e = classifyProviderError({ message: "socket hang up" }, "openrouter")
    expect(e.kind).toBe("provider")
    expect(e.status).toBe(502)
    expect(e.message).toContain("socket hang up")
  })

  it("passes an existing RedesignEngineError through unchanged", () => {
    const orig = new RedesignEngineError("safety", "blocked", 422)
    expect(classifyProviderError(orig, "google")).toBe(orig)
  })
})
