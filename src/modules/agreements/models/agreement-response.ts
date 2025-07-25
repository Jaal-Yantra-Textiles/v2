import { model } from "@medusajs/framework/utils";
import Agreement from "./agreement";

const AgreementResponse = model.define("agreement_response", {
  id: model.id().primaryKey(),
 // Response details
  status: model
    .enum(["sent", "viewed", "agreed", "disagreed", "expired"])
    .default("sent"),
  
  // Timestamps
  sent_at: model.dateTime(),
  viewed_at: model.dateTime().nullable(),
  responded_at: model.dateTime().nullable(),
  
  // Response data
  agreed: model.boolean().nullable(), // true = agreed, false = disagreed, null = no response
  response_notes: model.text().nullable(), // Optional notes from the person
  
  // Email tracking
  email_sent_to: model.text(), // Email address where agreement was sent
  email_opened: model.boolean().default(false),
  email_opened_at: model.dateTime().nullable(),
  
  // Secure access token for web access
  access_token: model.text().unique(), // Unique token for secure web access
  
  // IP and user agent for tracking (optional)
  response_ip: model.text().nullable(),
  response_user_agent: model.text().nullable(),
  
  // Metadata for additional tracking data
  metadata: model.json().nullable(),

  agreement: model.belongsTo(() => Agreement, { mappedBy: "responses" }),
});

export default AgreementResponse;
