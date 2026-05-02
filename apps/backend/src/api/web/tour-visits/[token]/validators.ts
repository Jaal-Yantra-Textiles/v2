import { z } from "@medusajs/framework/zod"

export const WebSaveTourItinerarySchema = z.object({
  selected_segments: z.array(z.string().min(1)).default([]),
  answers: z.record(z.string(), z.any()).default({}),
})

export type WebSaveTourItinerary = z.infer<typeof WebSaveTourItinerarySchema>
