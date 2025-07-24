import { model } from "@medusajs/framework/utils";
import AgreementResponse from "./agreement-response";

const Agreement = model.define("agreement", {
  id: model.id().primaryKey(),
  title: model.text().searchable(),
  content: model.text(), // HTML content of the agreement
  template_key: model.text().nullable(), // Optional: reference to email template
  
  // Agreement status and tracking
  status: model
    .enum(["draft", "active", "expired", "cancelled"])
    .default("draft"),
  
  // Validity period
  valid_from: model.dateTime().nullable(),
  valid_until: model.dateTime().nullable(),
  
  // Email settings
  subject: model.text().default("Agreement for Review"),
  from_email: model.text().nullable(),
  
  // Tracking
  sent_count: model.number().default(0),
  response_count: model.number().default(0),
  agreed_count: model.number().default(0),
  
  // Metadata for additional data
  metadata: model.json().nullable(),

  responses: model.hasMany(() => AgreementResponse, { mappedBy: "agreement" }),
});

export default Agreement;
