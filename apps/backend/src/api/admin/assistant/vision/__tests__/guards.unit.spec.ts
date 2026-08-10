/**
 * Vision guards (#1238).
 *
 * Each case here is a failure observed against Cloudflare Workers AI on
 * 2026-08-10, not a hypothetical. The point of the guards is that none of these
 * failures announce themselves: the dangerous ones return HTTP 200.
 */
import {
  explainEmptyAnswer,
  explainFailure,
  isKnownTextOnly,
} from "../guards"

describe("isKnownTextOnly", () => {
  it("refuses the model the admin assistant actually runs on", () => {
    // Measured: this returns 200 with the image silently dropped, so the model
    // answers blind. There is no error to catch — refusing is the only guard.
    expect(isKnownTextOnly("@cf/zai-org/glm-5.2")).toBe(true)
  })

  it("matches the same weights however a provider addresses them", () => {
    for (const id of ["z-ai/glm-5.2", "glm-5.2:free", "@cf/zai-org/GLM-5.2"]) {
      expect([id, isKnownTextOnly(id)]).toEqual([id, true])
    }
  })

  it("allows the models that genuinely read images", () => {
    for (const id of [
      "@cf/google/gemma-4-26b-a4b-it",
      "@cf/meta/llama-4-scout-17b-16e-instruct",
      "@cf/meta/llama-3.2-11b-vision-instruct",
    ]) {
      expect([id, isKnownTextOnly(id)]).toEqual([id, false])
    }
  })

  it("does not block an unknown model — an allowlist would freeze the catalog", () => {
    expect(isKnownTextOnly("@cf/some/model-shipped-next-week")).toBe(false)
    expect(isKnownTextOnly(undefined)).toBe(false)
  })
})

describe("explainFailure", () => {
  it("names the licence wall for a gated model", () => {
    // Verbatim shape of Cloudflare's refusal for llama-3.2-11b-vision-instruct.
    const e = {
      statusCode: 403,
      message:
        "AiError: Model Agreement: Prior to using this model, you must submit the prompt 'agree'.",
    }
    const out = explainFailure(e, "@cf/meta/llama-3.2-11b-vision-instruct")
    expect(out.status).toBe(424)
    expect(out.error).toMatch(/licence-gated/i)
  })

  it("detects the licence wall from the message even without a status", () => {
    const out = explainFailure({ message: "community license not accepted" })
    expect(out.status).toBe(424)
  })

  it("separates bad credentials from a bad model", () => {
    const out = explainFailure({ statusCode: 401, message: "Unauthorized" })
    expect(out.status).toBe(424)
    expect(out.error).toMatch(/API key/i)
  })

  it("marks rate limiting as retryable", () => {
    expect(explainFailure({ statusCode: 429 }).status).toBe(429)
  })

  it("explains a timeout in terms of how slow these models really are", () => {
    const out = explainFailure({ message: "ETIMEDOUT" })
    expect(out.status).toBe(504)
    expect(out.error).toMatch(/30s/)
  })

  it("falls back to 502 with the provider's own words", () => {
    const out = explainFailure({ message: "socket hang up" })
    expect(out.status).toBe(502)
    expect(out.error).toMatch(/socket hang up/)
  })

  it("never produces an empty explanation", () => {
    expect(explainFailure(undefined).error).toMatch(/unknown provider error/)
  })
})

describe("explainEmptyAnswer", () => {
  it("explains the reasoning-model token trap", () => {
    // gemma-4 at max_tokens 700: 16s, finish_reason "length", content "" —
    // the whole answer went to reasoning_content. Reads as a dead provider.
    const msg = explainEmptyAnswer("@cf/google/gemma-4-26b-a4b-it", "length")
    expect(msg).toMatch(/token budget reasoning/i)
    expect(msg).toMatch(/narrower question/i)
  })

  it("says something different when the model simply had nothing to say", () => {
    const msg = explainEmptyAnswer("@cf/google/gemma-4-26b-a4b-it", "stop")
    expect(msg).toMatch(/empty response/i)
    expect(msg).not.toMatch(/token budget/i)
  })
})
