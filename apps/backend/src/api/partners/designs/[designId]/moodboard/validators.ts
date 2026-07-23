import { z } from "@medusajs/framework/zod"

/**
 * PUT /partners/designs/:designId/moodboard — persist the Excalidraw scene the
 * designer authored on the canvas (#1113 S3).
 *
 * The scene is stored verbatim in the `moodboard` json column (same shape the
 * generate route emits and the viewer reads): { type, version, source,
 * elements[], appState{}, files{} }. We validate the envelope loosely — the
 * canvas owns the element schema — but require it to be an object.
 */
export const SavePartnerMoodboardSchema = z.object({
  moodboard: z.record(z.string(), z.any()),
})

export type SavePartnerMoodboard = z.infer<typeof SavePartnerMoodboardSchema>
