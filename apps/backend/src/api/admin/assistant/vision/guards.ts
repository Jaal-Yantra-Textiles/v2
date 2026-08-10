/**
 * Pure guards for on-demand image reading.
 *
 * Split out of route.ts so the failure modes can be asserted directly — every
 * rule here was written against a live probe, not a spec sheet, and each one
 * corresponds to a way a vision call fails WITHOUT throwing anything obvious.
 */

/**
 * Models that accept an `image_url` part and ignore it.
 *
 * This is the dangerous class. Cloudflare returns HTTP 200 for
 * `@cf/zai-org/glm-5.2` with an image attached, having silently dropped the
 * image — the model then answers from the text alone, confidently and wrongly.
 * Refusing up front is the only safe handling: there is no error to catch.
 *
 * Substring-matched because the same weights are addressed many ways across
 * providers (`@cf/zai-org/glm-5.2`, `z-ai/glm-5.2`, `glm-5.2:free`).
 */
export const TEXT_ONLY_MODEL_HINTS = [
  "glm-5.2",
  "glm-4.6",
  "llama-3.3-70b",
  "qwen-turbo",
  "gpt-oss",
]

export const isKnownTextOnly = (modelId?: string): boolean => {
  if (!modelId) {
    return false
  }
  const id = modelId.toLowerCase()
  return TEXT_ONLY_MODEL_HINTS.some((hint) => id.includes(hint))
}

export type VisionFailure = { status: number; error: string }

/**
 * Turn a provider failure into something an operator can act on.
 *
 * Every branch is a real observed failure: a licence-gated model (Meta's
 * community licence must be accepted per-account before
 * `@cf/meta/llama-3.2-11b-vision-instruct` will answer), bad credentials, rate
 * limits, and the 30s+ timeouts reasoning vision models genuinely take.
 */
export const explainFailure = (e: any, modelId?: string): VisionFailure => {
  const raw = String(e?.message ?? e ?? "")
  const status = e?.statusCode ?? e?.status

  if (
    status === 403 ||
    /model agreement|community license|must submit the prompt/i.test(raw)
  ) {
    return {
      status: 424,
      error:
        `The vision model ${modelId ?? ""} is licence-gated and has not been accepted for this ` +
        `account. Accept its licence in the provider dashboard, or point the ` +
        `ai_image_extraction platform at a different model.`,
    }
  }
  if (status === 401 || /unauthor|forbidden|invalid api key/i.test(raw)) {
    return {
      status: 424,
      error:
        "The vision provider rejected our credentials. Check the API key on the " +
        "ai_image_extraction platform in Settings → External Platforms.",
    }
  }
  if (status === 429 || /rate limit|too many requests/i.test(raw)) {
    return {
      status: 429,
      error: "The vision provider is rate-limiting us. Try again in a moment.",
    }
  }
  if (/timeout|etimedout|aborted/i.test(raw)) {
    return {
      status: 504,
      error:
        "The vision model timed out. Reasoning models can take 30s+ on a dense " +
        "image — retry, or pass a faster model explicitly.",
    }
  }
  return {
    status: 502,
    error: `The vision model could not read the image: ${raw || "unknown provider error"}`,
  }
}

/**
 * Why an empty answer happened.
 *
 * Reasoning vision models emit their working into `reasoning_content` and leave
 * `content` empty until they reach an answer — so a token cap produces a
 * perfectly successful-looking response containing nothing. Measured: gemma-4 at
 * a 700-token cap returned "" after 16s. Without this message that reads as a
 * dead provider and gets debugged as one.
 */
export const explainEmptyAnswer = (
  modelId: string | undefined,
  finishReason?: string
): string =>
  finishReason === "length"
    ? `${modelId} used its entire token budget reasoning and never emitted an ` +
      `answer. Ask a narrower question about the image, or switch the ` +
      `ai_image_extraction platform to a faster non-reasoning vision model.`
    : `${modelId} returned an empty response for this image.`
