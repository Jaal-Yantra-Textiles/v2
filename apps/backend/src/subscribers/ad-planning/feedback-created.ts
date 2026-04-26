/**
 * Feedback Created Subscriber
 *
 * Automatically analyzes sentiment when feedback is submitted.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { analyzeSentimentWorkflow } from "../../workflows/ad-planning/sentiment/analyze-sentiment";
import { calculateNPSWorkflow } from "../../workflows/ad-planning/scoring/calculate-nps";

type FeedbackCreatedEvent = {
  id: string;
  person_id?: string;
  content?: string;
  rating?: number;
  scale?: "5" | "10";
  website_id?: string;
  form_id?: string;
};

export default async function feedbackCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<FeedbackCreatedEvent>) {
  try {
    const feedback = data;

    // Guard against malformed event payloads — workflows downstream
    // assume a real feedback ID.
    if (!feedback?.id) {
      console.warn("[AdPlanning] feedback.created event missing id — skipping");
      return;
    }

    // Analyze sentiment if there's enough text content
    if (feedback.content && feedback.content.trim().length >= 10) {
      try {
        await analyzeSentimentWorkflow(container).run({
          input: {
            text: feedback.content,
            source_type: "feedback",
            source_id: feedback.id,
            person_id: feedback.person_id,
            website_id: feedback.website_id,
            metadata: {
              rating: feedback.rating,
              form_id: feedback.form_id,
            },
          },
        });
        console.log(
          `[AdPlanning] Sentiment analyzed for feedback: ${feedback.id}`
        );
      } catch (error) {
        console.error(
          "[AdPlanning] Failed to analyze feedback sentiment:",
          error
        );
      }
    }

    // Auto-calculate NPS if feedback includes a numeric rating and has a person
    if (feedback.rating && feedback.person_id) {
      // Prefer an explicit `scale` field on the event. Only fall back to
      // inferring from the rating value if scale is missing — and when
      // inferring, use `< 6` so that a rating of exactly 5 is always
      // treated as 5-point (which is the valid range for a 5-point
      // instrument) without silently misrouting an explicit 10-point 5.
      const explicitScale: "5" | "10" | undefined = feedback.scale;
      const scale: "5" | "10" =
        explicitScale ?? (feedback.rating < 6 ? "5" : "10");

      try {
        await calculateNPSWorkflow(container).run({
          input: {
            person_id: feedback.person_id,
            rating: feedback.rating,
            scale,
            source_id: feedback.id,
            source_type: "feedback",
          },
        });
        console.log(
          `[AdPlanning] NPS calculated from feedback rating for: ${feedback.person_id}`
        );
      } catch (error) {
        console.error(
          "[AdPlanning] Failed to calculate NPS from feedback:",
          error
        );
      }
    }
  } catch (error) {
    console.error("[AdPlanning] feedback-created subscriber failed:", error);
  }
}

export const config: SubscriberConfig = {
  event: "feedback.created",
};
