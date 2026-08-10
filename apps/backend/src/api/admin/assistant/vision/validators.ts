import { z } from "@medusajs/framework/zod"

/**
 * On-demand image reading for the admin assistant.
 *
 * Deliberately explicit: attaching an image to the chat does NOT send its pixels
 * anywhere. The operator (or the model, on the operator's instruction) has to ask
 * for the image to be read, and that lands here.
 */
export const AdminAssistantVisionSchema = z.object({
  image_url: z.string().trim().min(1),
  /** What to look for. Defaults to a generic describe-and-transcribe prompt. */
  prompt: z.string().trim().min(1).max(2000).optional(),
  /**
   * Override the model resolved for the `ai_image_extraction` role. Lets an
   * operator trade accuracy for latency per call without reconfiguring the
   * platform (gemma-4 reads handwriting better; llama-4-scout answers ~5x faster).
   */
  model: z.string().trim().min(1).optional(),
})

export type AdminAssistantVisionReq = z.infer<typeof AdminAssistantVisionSchema>
