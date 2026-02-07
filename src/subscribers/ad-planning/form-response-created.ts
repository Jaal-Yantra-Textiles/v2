/**
 * Form Response Created Subscriber
 *
 * Tracks conversions when form responses are submitted.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { trackLeadConversionWorkflow } from "../../workflows/ad-planning/conversions/track-lead-conversion";

type FormResponseCreatedEvent = {
  id: string;
  form_id: string;
  person_id?: string;
  website_id?: string;
  visitor_id?: string;
  session_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  landing_page?: string;
  conversion_page?: string;
  response_data?: Record<string, any>;
};

export default async function formResponseCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<FormResponseCreatedEvent>) {
  try {
    const response = data;

    if (!response.id || !response.form_id) {
      console.warn("[AdPlanning] Form response event missing required fields");
      return;
    }

    // Run the lead conversion tracking workflow
    await trackLeadConversionWorkflow(container).run({
      input: {
        form_id: response.form_id,
        form_response_id: response.id,
        person_id: response.person_id,
        website_id: response.website_id,
        visitor_id: response.visitor_id,
        session_id: response.session_id,
        utm_source: response.utm_source,
        utm_medium: response.utm_medium,
        utm_campaign: response.utm_campaign,
        landing_page: response.landing_page,
        conversion_page: response.conversion_page,
        lead_data: response.response_data,
      },
    });

    console.log(`[AdPlanning] Form response conversion tracked: ${response.id}`);
  } catch (error) {
    console.error("[AdPlanning] Failed to track form response conversion:", error);
  }
}

export const config: SubscriberConfig = {
  event: "form_response.created",
};
