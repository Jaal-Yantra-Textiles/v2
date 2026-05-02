import { z } from "@medusajs/framework/zod"

export const WebSaveTourItinerarySchema = z.object({
  selected_segments: z.array(z.string().min(1)).default([]),
  answers: z.record(z.string(), z.any()).default({}),
  // When true, the route triggers the tour-itinerary-confirmation email.
  // The wizard sends this only on the final "Confirm itinerary" click;
  // intermediate auto-saves leave it false.
  confirm: z.boolean().default(false),
  // Public visit URL the customer is on; included in the confirmation
  // email so they can return to their itinerary.
  visit_url: z.string().url().optional(),
})

export type WebSaveTourItinerary = z.infer<typeof WebSaveTourItinerarySchema>
