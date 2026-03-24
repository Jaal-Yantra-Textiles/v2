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
  website_id?: string;
  form_id?: string;
};

export default async function feedbackCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<FeedbackCreatedEvent>) {
  const feedback = data;

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
      console.log(`[AdPlanning] Sentiment analyzed for feedback: ${feedback.id}`);
    } catch (error) {
      console.error("[AdPlanning] Failed to analyze feedback sentiment:", error);
    }
  }

  // Auto-calculate NPS if feedback includes a numeric rating and has a person
  if (feedback.rating && feedback.person_id) {
    try {
      await calculateNPSWorkflow(container).run({
        input: {
          person_id: feedback.person_id,
          rating: feedback.rating,
          scale: feedback.rating <= 5 ? "5" : "10",
          source_id: feedback.id,
          source_type: "feedback",
        },
      });
      console.log(`[AdPlanning] NPS calculated from feedback rating for: ${feedback.person_id}`);
    } catch (error) {
      console.error("[AdPlanning] Failed to calculate NPS from feedback:", error);
    }
  }
}

export const config: SubscriberConfig = {
  event: "feedback.created",
};
