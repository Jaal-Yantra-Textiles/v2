import { z } from "@medusajs/framework/zod"

/**
 * Pure helpers for the #892 /outline route (imagetracerjs vectorization).
 * DI-free + network-free so they unit-test without a container, sharp, or the tracer.
 *
 * The route turns a raster flat/cutout (or, ideally, a /segment mask) into an
 * editable SVG outline — the sewable-spec companion to the exploratory /redesign
 * render. imagetracerjs (Unlicense/public-domain — no GPL exposure, unlike potrace)
 * colour-quantizes then traces: "outline" mode quantizes to 2 colours for a clean
 * silhouette, "posterize" keeps `steps` tonal layers.
 */

export const OutlineBodySchema = z
  .object({
    image_url: z.string().url().optional(),
    image_base64: z.string().min(1).optional(),
    /** "outline" = single-threshold silhouette (default). "posterize" = layered tonal fills. */
    mode: z.enum(["outline", "posterize"]).default("outline"),
    /** Luminance cutoff 0–255; -1 = auto (potrace's histogram threshold). */
    threshold: z.number().int().min(-1).max(255).default(-1),
    /** Despeckle: drop traced regions smaller than this many pixels. */
    turd_size: z.number().int().min(0).max(5000).default(2),
    /** Curve optimization tolerance; higher = fewer, smoother segments. */
    opt_tolerance: z.number().min(0).max(5).default(0.2),
    /** Trace dark-on-light (true, for flats/cutouts) or light-on-dark (false, for masks). */
    black_on_white: z.boolean().default(true),
    /** posterize only: number of tonal layers. */
    steps: z.number().int().min(2).max(8).default(3),
    color: z.string().min(1).max(64).default("black"),
    background: z.string().min(1).max(64).default("transparent"),
  })
  .refine((d) => !!(d.image_url || d.image_base64), {
    message: "either image_url or image_base64 is required",
    path: ["image_url"],
  })

export type OutlineBody = z.infer<typeof OutlineBodySchema>

/**
 * Map the validated body onto an imagetracerjs options object. The route body stays
 * potrace-shaped for API stability; here we translate to the tracer's vocabulary:
 *   - mode        → numberofcolors (2 = silhouette, `steps` = posterized layers)
 *   - turd_size   → pathomit       (drop paths shorter than this — despeckle)
 *   - opt_tolerance → ltres/qtres  (straight/curve error thresholds; higher = smoother)
 * `threshold`, `black_on_white`, `color`, `background` remain accepted for
 * compatibility but don't drive the colour quantizer (kept minimal on purpose).
 */
export function buildTracerOptions(body: OutlineBody): Record<string, unknown> {
  const tol = Math.max(0.01, body.opt_tolerance * 5) // 0.2 (default) → 1.0 (tracer default)
  return {
    numberofcolors: body.mode === "posterize" ? body.steps : 2,
    colorquantcycles: 1,
    pathomit: body.turd_size,
    ltres: tol,
    qtres: tol,
    linefilter: true,
    scale: 1,
  }
}

/**
 * Decode an `image_base64` value (a `data:` URL or a bare base64 blob) into a Buffer.
 * potrace loads from a Buffer directly, so this is all the route needs for base64 input.
 */
export function decodeImageBase64(image_base64: string): {
  buffer: Buffer
  mimeType: string
} {
  const m = image_base64.match(/^data:([^;]+);base64,(.+)$/)
  if (m) {
    return { buffer: Buffer.from(m[2], "base64"), mimeType: m[1] }
  }
  return { buffer: Buffer.from(image_base64, "base64"), mimeType: "image/png" }
}

/** Wrap raw SVG markup as a data URL so the canvas can embed it like any image. */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`
}

/** Pull width/height off the root <svg> element (potrace emits them as integers). */
export function parseSvgDimensions(svg: string): {
  width: number | null
  height: number | null
} {
  const w = svg.match(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"/)
  const h = svg.match(/<svg[^>]*\bheight="(\d+(?:\.\d+)?)"/)
  return {
    width: w ? Number(w[1]) : null,
    height: h ? Number(h[1]) : null,
  }
}

/** A tiny valid SVG returned in test env so the route wiring is exercised for free. */
export const MOCK_OUTLINE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
  '<path d="M10 10 H90 V90 H10 Z" fill="black"/></svg>'
