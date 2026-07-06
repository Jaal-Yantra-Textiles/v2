import { z } from "@medusajs/framework/zod"

/**
 * Pure helpers for the #892 /outline route (potrace vectorization).
 * DI-free + network-free so they unit-test without a container, fal, or potrace.
 *
 * The route turns a raster flat/cutout (or, ideally, a /segment mask) into an
 * editable SVG outline — the sewable-spec companion to the exploratory /redesign
 * render. potrace traces dark regions as foreground by default (`black_on_white`);
 * a segmentation mask (white foreground on black) should pass `black_on_white:false`.
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

/** Map the validated body onto a potrace options object (shared + mode-specific). */
export function buildPotraceParams(body: OutlineBody): Record<string, unknown> {
  const shared: Record<string, unknown> = {
    turdSize: body.turd_size,
    optTolerance: body.opt_tolerance,
    blackOnWhite: body.black_on_white,
    color: body.color,
    background: body.background,
  }
  // -1 means "let potrace pick" — only pin a threshold when the caller set one.
  if (body.threshold >= 0) {
    shared.threshold = body.threshold
  }
  if (body.mode === "posterize") {
    return { ...shared, steps: body.steps }
  }
  return shared
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
