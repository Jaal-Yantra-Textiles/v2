import { fileToDataUrl } from "./redesign-support"

/**
 * Redesign engines (#892). Two independent ways to run Nano-Banana
 * (`gemini-2.5-flash-image`) so we're not locked to a single provider:
 *
 *   - "openrouter" → @openrouter/ai-sdk-provider (validated working today)
 *   - "google"     → direct Google Generative Language REST API (no gateway, no
 *                    AI-SDK version skew; needs a billed GOOGLE key)
 *
 * Both take the same (prompt, image) and return a displayable data-URL, so the route
 * dispatches on the resolved engine without caring which provider served the pixels.
 */

export type RedesignEngine = "openrouter" | "google"

/** Normalize an image (http URL or data URL) into base64 inline data for a REST body. */
export async function parseImageToInlineData(
  image: string
): Promise<{ mimeType: string; data: string }> {
  if (image.startsWith("data:")) {
    const m = image.match(/^data:([^;]+);base64,(.+)$/)
    if (!m) throw new Error("image must be a valid base64 data URL")
    return { mimeType: m[1], data: m[2] }
  }
  const res = await fetch(image)
  if (!res.ok) throw new Error(`failed to fetch input image (${res.status})`)
  const mimeType = res.headers.get("content-type") || "image/png"
  const buf = Buffer.from(await res.arrayBuffer())
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

  const result: any = await generateText({
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
  const file = (result.files || []).find((f: any) =>
    f.mediaType?.startsWith("image/")
  )
  if (!file) {
    throw new Error(
      `no image in OpenRouter response (text: ${String(result.text).slice(0, 120)})`
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

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: opts.prompt },
            { inline_data: { mime_type: mimeType, data } },
          ],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google API ${res.status}: ${body.slice(0, 200)}`)
  }
  const json: any = await res.json()
  const parts = json?.candidates?.[0]?.content?.parts || []
  const img = parts.find((p: any) => p.inlineData || p.inline_data)
  const inline = img?.inlineData || img?.inline_data
  if (!inline?.data) {
    throw new Error("no image in Google response")
  }
  const mt = inline.mimeType || inline.mime_type || "image/png"
  return `data:${mt};base64,${inline.data}`
}

/** Dispatch to the resolved engine. */
export async function runRedesignEngine(
  engine: RedesignEngine,
  opts: { apiKey: string; model: string; prompt: string; image: string }
): Promise<string> {
  return engine === "google"
    ? generateViaGoogle(opts)
    : generateViaOpenRouter(opts)
}
