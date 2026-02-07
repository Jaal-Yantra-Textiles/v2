/**
 * Lead Created Subscriber
 *
 * Tracks lead form submission conversions when leads are created.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { trackLeadConversionWorkflow } from "../../workflows/ad-planning/conversions/track-lead-conversion";

type LeadCreatedEvent = {
  id: string;
  person_id?: string;
  form_id?: string;
  website_id?: string;
  visitor_id?: string;
  session_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  landing_page?: string;
};

export default async function leadCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<LeadCreatedEvent>) {
  try {
    const lead = data;

    if (!lead.id) {
      console.warn("[AdPlanning] Lead created event missing lead ID");
      return;
    }

    // Run the lead conversion tracking workflow
    await trackLeadConversionWorkflow(container).run({
      input: {
        lead_id: lead.id,
        person_id: lead.person_id,
        form_id: lead.form_id,
        website_id: lead.website_id,
        visitor_id: lead.visitor_id,
        session_id: lead.session_id,
        utm_source: lead.utm_source,
        utm_medium: lead.utm_medium,
        utm_campaign: lead.utm_campaign,
        utm_term: lead.utm_term,
        utm_content: lead.utm_content,
        landing_page: lead.landing_page,
      },
    });

    console.log(`[AdPlanning] Lead conversion tracked for lead: ${lead.id}`);
  } catch (error) {
    console.error("[AdPlanning] Failed to track lead conversion:", error);
  }
}

export const config: SubscriberConfig = {
  event: "lead.created",
};
