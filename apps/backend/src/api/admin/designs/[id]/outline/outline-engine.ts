import { decodeImageBase64 } from "./outline-support"

/**
 * Vectorization engine for the #892 /outline route. Isolated from the pure helpers
 * because it touches the network (fetching image_url), sharp (raster decode), and
 * imagetracerjs (Unlicense — no GPL exposure). All failures are normalized to
 * OutlineEngineError { kind, status } so the route can return a controlled, readable
 * response (Medusa scrubs the body of any 500-level error).
 */

export type OutlineErrorKind =
  | "bad_input" // input image couldn't be fetched/read
  | "no_trace" // potrace produced nothing (blank/mono image)
  | "provider" // potrace threw

export class OutlineEngineError extends Error {
  kind: OutlineErrorKind
  status: number
  constructor(kind: OutlineErrorKind, message: string, status: number) {
    super(message)
    this.name = "OutlineEngineError"
    this.kind = kind
    this.status = status
  }
}

const MAX_INPUT_BYTES = 15 * 1024 * 1024 // 15 MB
const FETCH_TIMEOUT_MS = 30_000

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new OutlineEngineError(
        "bad_input",
        "Fetching the input image timed out. Try again or pass image_base64.",
        400
      )
    }
    throw new OutlineEngineError(
      "bad_input",
      `Couldn't fetch the input image: ${String(err?.message || err).slice(0, 120)}`,
      400
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Resolve the request body to a raster Buffer potrace can load (URL fetch or base64 decode). */
export async function resolveImageBuffer(body: {
  image_url?: string
  image_base64?: string
}): Promise<Buffer> {
  if (body.image_url) {
    const res = await fetchWithTimeout(body.image_url)
    if (!res.ok) {
      throw new OutlineEngineError(
        "bad_input",
        `Couldn't fetch the input image (HTTP ${res.status}).`,
        400
      )
    }
    const mimeType = res.headers.get("content-type") || "image/png"
    if (!mimeType.startsWith("image/")) {
      throw new OutlineEngineError(
        "bad_input",
        `The input URL is not an image (got ${mimeType}).`,
        400
      )
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_INPUT_BYTES) {
      throw new OutlineEngineError("bad_input", "The input image is too large (max 15 MB).", 400)
    }
    return buf
  }

  const { buffer } = decodeImageBase64(body.image_base64 as string)
  if (!buffer.byteLength) {
    throw new OutlineEngineError("bad_input", "The input image_base64 decoded to nothing.", 400)
  }
  if (buffer.byteLength > MAX_INPUT_BYTES) {
    throw new OutlineEngineError("bad_input", "The input image is too large (max 15 MB).", 400)
  }
  return buffer
}

/** Decode a raster Buffer (PNG/JPEG/WebP/…) into ImageData-shaped RGBA pixels via sharp. */
async function decodeToImageData(
  buffer: Buffer
): Promise<{ width: number; height: number; data: Buffer }> {
  const sharp = (await import("sharp")).default
  const { data, info } = await sharp(buffer)
    .ensureAlpha() // imagetracerjs needs 4 channels (RGBA)
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

/**
 * Trace a raster Buffer into SVG markup via imagetracerjs. `options` is the tracer
 * options object from buildTracerOptions() (mode is already baked in as numberofcolors).
 * Resolves to the SVG string.
 */
export async function runTracer(
  buffer: Buffer,
  options: Record<string, unknown>
): Promise<string> {
  let imageData: { width: number; height: number; data: Buffer }
  try {
    imageData = await decodeToImageData(buffer)
  } catch (err: any) {
    throw new OutlineEngineError(
      "bad_input",
      `Couldn't decode the input image: ${String(err?.message || err).slice(0, 120)}`,
      400
    )
  }

  const mod: any = await import("imagetracerjs")
  const ImageTracer = mod?.default ?? mod

  let svg: string
  try {
    svg = ImageTracer.imagedataToSVG(
      { width: imageData.width, height: imageData.height, data: imageData.data },
      options
    )
  } catch (err: any) {
    throw new OutlineEngineError(
      "provider",
      `Vectorization failed: ${String(err?.message || err).slice(0, 160)}`,
      502
    )
  }

  // A blank/mono input traces to an SVG with no <path> — surface that as a clear 422
  // instead of handing back an empty outline.
  if (!svg || !/<path\b/.test(svg)) {
    throw new OutlineEngineError(
      "no_trace",
      "Nothing to trace — the image had no distinct foreground. Try a cutout/mask.",
      422
    )
  }
  return svg
}
