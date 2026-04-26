import { model } from "@medusajs/framework/utils";

const AgreementResponse = model.define("agreement_response", {
  id: model.id().primaryKey(),
  status: model
    .enum(["sent", "viewed", "agreed", "disagreed", "expired"])
    .default("sent"),

  // Timestamps
  sent_at: model.dateTime(),
  viewed_at: model.dateTime().nullable(),
  responded_at: model.dateTime().nullable(),

  // Response data
  agreed: model.boolean().nullable(),
  response_notes: model.text().nullable(),

  // Email tracking
  email_sent_to: model.text(),
  email_opened: model.boolean().default(false),
  email_opened_at: model.dateTime().nullable(),

  // Secure access token for web access
  access_token: model.text().unique(),

  // IP and user agent for tracking
  response_ip: model.text().nullable(),
  response_user_agent: model.text().nullable(),

  // Metadata
  metadata: model.json().nullable(),

  // Plain text reference to agreement (relationship managed via module link)
  agreement_id: model.text(),
});

export default AgreementResponse;
