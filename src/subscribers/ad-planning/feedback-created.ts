/**
 * Feedback Created Subscriber
 *
 * Automatically analyzes sentiment when feedback is submitted.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { analyzeSentimentWorkflow } from "../../workflows/ad-planning/sentiment/analyze-sentiment";

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
  try {
    const feedback = data;

    // Need text content to analyze
    if (!feedback.content || feedback.content.trim().length < 10) {
      return;
    }

    // Run sentiment analysis
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

export const config: SubscriberConfig = {
  event: "feedback.created",
};
