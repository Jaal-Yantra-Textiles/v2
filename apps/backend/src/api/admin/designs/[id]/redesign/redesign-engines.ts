import { fileToDataUrl } from "./redesign-support"

/**
 * Redesign engines (#892). Two independent ways to run Nano-Banana
 * (`gemini-2.5-flash-image`) so we're not locked to a single provider:
 *
 *   - "openrouter" → @openrouter/ai-sdk-provider (validated working today)
 *   - "google"     → direct Google Generative Language REST API (no gateway, no
 *                    AI-SDK version skew; needs a billed GOOGLE key)
 *
 * Both take the same (prompt, image) and return a displayable data-URL. All provider
 * failures are normalized to RedesignEngineError with a { kind, status } so the route
 * can return a controlled, user-actionable response (Medusa scrubs the message on any
 * 500, so provider errors MUST surface as 4xx/429 to be readable in the admin UI).
 */

export type RedesignEngine = "openrouter" | "google"

export type RedesignErrorKind =
  | "rate_limit" // 429 / quota exhausted
  | "auth" // bad/rejected API key
  | "safety" // blocked by the model's safety filter
  | "no_image" // provider succeeded but returned no image
  | "bad_input" // input image couldn't be read
  | "provider" // anything else upstream

/** A normalized, user-surfaceable engine failure. `status` is the HTTP code to return. */
export class RedesignEngineError extends Error {
  kind: RedesignErrorKind
  status: number
  constructor(kind: RedesignErrorKind, message: string, status: number) {
    super(message)
    this.name = "RedesignEngineError"
    this.kind = kind
    this.status = status
  }
}

/** Cap the input image so we never ship an oversized payload to a provider. */
const MAX_INPUT_BYTES = 15 * 1024 * 1024 // 15 MB
const FETCH_TIMEOUT_MS = 45_000

function httpStatusOf(err: any): number | undefined {
  return (
    err?.statusCode ??
    err?.status ??
    err?.response?.status ??
    err?.cause?.statusCode ??
    undefined
  )
}

/** Map a thrown provider error (AI SDK / fetch) onto a normalized engine error. */
export function classifyProviderError(
  err: any,
  engine: RedesignEngine
): RedesignEngineError {
  if (err instanceof RedesignEngineError) return err
  const code = httpStatusOf(err)
  const msg = String(err?.message || err?.responseBody || err?.data || "").toLowerCase()

  if (code === 429 || /\b(rate.?limit|quota|exceeded|too many requests|429)\b/.test(msg)) {
    return new RedesignEngineError(
      "rate_limit",
      "The redesign provider is rate-limited or out of quota. Try again shortly, or check the provider's plan/billing.",
      429
    )
  }
  if (
    code === 401 ||
    code === 403 ||
    /\b(unauthorized|forbidden|invalid api key|invalid.*key|permission denied|authentication)\b/.test(msg)
  ) {
    return new RedesignEngineError(
      "auth",
      `The ${engine} provider rejected the API key. Check the key configured in Settings → External Platforms (role ai_redesign), or the fallback env var.`,
      502
    )
  }
  const detail = String(err?.message || "unknown error").slice(0, 200)
  return new RedesignEngineError("provider", `Redesign provider error: ${detail}`, 502)
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new RedesignEngineError(
        "provider",
        "The redesign provider timed out. Try again.",
        504
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Normalize an image (http URL or data URL) into base64 inline data for a REST body. */
export async function parseImageToInlineData(
  image: string
): Promise<{ mimeType: string; data: string }> {
  if (image.startsWith("data:")) {
    const m = image.match(/^data:([^;]+);base64,(.+)$/)
    if (!m) {
      throw new RedesignEngineError(
        "bad_input",
        "The input image must be a valid base64 data URL.",
        400
      )
    }
    const [, mimeType, data] = m
    if (!mimeType.startsWith("image/")) {
      throw new RedesignEngineError("bad_input", "The input must be an image.", 400)
    }
    // base64 length → byte size (approx): 4 chars ≈ 3 bytes.
    if ((data.length * 3) / 4 > MAX_INPUT_BYTES) {
      throw new RedesignEngineError("bad_input", "The input image is too large (max 15 MB).", 400)
    }
    return { mimeType, data }
  }

  let res: Response
  try {
    res = await fetchWithTimeout(image)
  } catch (err: any) {
    if (err instanceof RedesignEngineError) throw err
    throw new RedesignEngineError(
      "bad_input",
      `Couldn't fetch the input image: ${String(err?.message || err).slice(0, 120)}`,
      400
    )
  }
  if (!res.ok) {
    throw new RedesignEngineError(
      "bad_input",
      `Couldn't fetch the input image (HTTP ${res.status}).`,
      400
    )
  }
  const mimeType = res.headers.get("content-type") || "image/png"
  if (!mimeType.startsWith("image/")) {
    throw new RedesignEngineError(
      "bad_input",
      `The input URL is not an image (got ${mimeType}).`,
      400
    )
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > MAX_INPUT_BYTES) {
    throw new RedesignEngineError("bad_input", "The input image is too large (max 15 MB).", 400)
  }
  return { mimeType, data: buf.toString("base64") }
}

/** OpenRouter engine — model id is the slash form, e.g. "google/gemini-2.5-flash-image". */
export async function generateViaOpenRouter(opts: {
  apiKey: string
  model: string
  prompt: string
  image: string
}): Promise<string> {
  const { createOpenRouter } = await import("@openrouter/ai-sdk-provider")
  const { generateText } = await import("ai")
  const openrouter = createOpenRouter({ apiKey: opts.apiKey })

  let result: any
  try {
    result = await generateText({
      model: openrouter(opts.model),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: opts.prompt },
            { type: "image", image: opts.image },
          ],
        },
      ],
    })
  } catch (err) {
    throw classifyProviderError(err, "openrouter")
  }

  const finish = result?.finishReason
  if (finish === "content-filter") {
    throw new RedesignEngineError(
      "safety",
      "The redesign was blocked by the model's safety filter. Adjust the prompt or use a different input image.",
      422
    )
  }
  const file = (result.files || []).find((f: any) => f.mediaType?.startsWith("image/"))
  if (!file) {
    throw new RedesignEngineError(
      "no_image",
      "The model returned no image. Try a more specific prompt or a clearer input image.",
      502
    )
  }
  return fileToDataUrl(file)
}

/** Direct Google engine — model id is the bare form, e.g. "gemini-2.5-flash-image". */
export async function generateViaGoogle(opts: {
  apiKey: string
  model: string
  prompt: string
  image: string
}): Promise<string> {
  const { mimeType, data } = await parseImageToInlineData(opts.image)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: opts.prompt }, { inline_data: { mime_type: mimeType, data } }],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw classifyProviderError(
      { statusCode: res.status, message: body || res.statusText },
      "google"
    )
  }

  const json: any = await res.json().catch(() => ({}))

  // Safety can block at the prompt level or the candidate level.
  const blockReason = json?.promptFeedback?.blockReason
  const finishReason = json?.candidates?.[0]?.finishReason
  if (
    blockReason ||
    ["SAFETY", "PROHIBITED_CONTENT", "IMAGE_SAFETY", "BLOCKLIST"].includes(finishReason)
  ) {
    throw new RedesignEngineError(
      "safety",
      `The redesign was blocked by the model's safety filter${
        blockReason ? ` (${blockReason})` : ""
      }. Adjust the prompt or use a different input image.`,
      422
    )
  }

  const parts = json?.candidates?.[0]?.content?.parts || []
  const img = parts.find((p: any) => p.inlineData || p.inline_data)
  const inline = img?.inlineData || img?.inline_data
  if (!inline?.data) {
    throw new RedesignEngineError(
      "no_image",
      "The model returned no image. Try a more specific prompt or a clearer input image.",
      502
    )
  }
  const mt = inline.mimeType || inline.mime_type || "image/png"
  return `data:${mt};base64,${inline.data}`
}

/** Dispatch to the resolved engine; always throws RedesignEngineError on failure. */
export async function runRedesignEngine(
  engine: RedesignEngine,
  opts: { apiKey: string; model: string; prompt: string; image: string }
): Promise<string> {
  try {
    return engine === "google"
      ? await generateViaGoogle(opts)
      : await generateViaOpenRouter(opts)
  } catch (err) {
    throw classifyProviderError(err, engine)
  }
}
