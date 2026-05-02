import { z } from "@medusajs/framework/zod"

export const WebSaveTourItinerarySchema = z.object({
  selected_segments: z.array(z.string().min(1)).default([]),
  answers: z.record(z.string(), z.any()).default({}),
  // When true, the route triggers the tour-itinerary-confirmation email.
  // The wizard sends this only on the final "Confirm itinerary" click;
  // intermediate auto-saves leave it false.
  confirm: z.boolean().default(false),
  // The visit URL is derived server-side from PUBLIC_TOUR_VISIT_BASE_URL
  // + the token (never trusted from the client) so a malicious payload
  // can't redirect the confirmation email to a phishing domain.
})

export type WebSaveTourItinerary = z.infer<typeof WebSaveTourItinerarySchema>
