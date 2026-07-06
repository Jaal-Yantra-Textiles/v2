import { z } from "@medusajs/framework/zod"

/**
 * Pure helpers for the #892 /redesign route (Nano-Banana / Gemini 2.5 Flash Image).
 * Kept DI-free so they can be unit-tested without a container or network.
 */

export const RedesignBodySchema = z
  .object({
    image_url: z.string().url().optional(),
    image_base64: z.string().min(1).optional(),
    prompt: z.string().trim().min(1, "prompt is required"),
  })
  .refine((d) => !!(d.image_url || d.image_base64), {
    message: "either image_url or image_base64 is required",
    path: ["image_url"],
  })

export type RedesignBody = z.infer<typeof RedesignBodySchema>

/**
 * Wrap the user's design direction in a structure-preserving instruction. The bake-off
 * (#892) chose Nano-Banana precisely because it applies details on-structure in one
 * shot; the instruction reinforces that generation is an *exploration* of the existing
 * garment, not a free redraw — the vector outline remains the sewable spec.
 */
export function buildRedesignPrompt(userPrompt: string): string {
  return [
    "You are editing an existing fashion garment image (a flat sketch or product photo).",
    "Preserve the garment's silhouette, proportions, seam lines and overall construction.",
    "Do not change the garment category, the pose, or add additional garments.",
    `Apply this design direction: ${userPrompt.trim()}.`,
    "Return a single clean image of the garment on a plain, neutral background.",
  ].join(" ")
}

/**
 * The image value handed to the AI SDK's `{ type: "image" }` content part. An http(s)
 * URL or a `data:` URL are both accepted verbatim; a bare base64 blob is promoted to a
 * PNG data URL.
 */
export function resolveImageInput(body: {
  image_url?: string
  image_base64?: string
}): string {
  if (body.image_url) return body.image_url
  const b64 = body.image_base64 as string
  return b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`
}

/** Normalize an AI SDK image file into a displayable data URL. */
export function fileToDataUrl(file: { mediaType?: string; base64: string }): string {
  return file.base64.startsWith("data:")
    ? file.base64
    : `data:${file.mediaType || "image/png"};base64,${file.base64}`
}

/** 1×1 transparent PNG — returned in test env so the route wiring is exercised for free. */
export const MOCK_REDESIGN_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
