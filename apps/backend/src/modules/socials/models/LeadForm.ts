import { model } from "@medusajs/framework/utils"
import AdAccount from "./AdAccount"
import Lead from "./Lead"

/**
 * LeadForm (Meta Lead Generation Form)
 * 
 * Represents a lead generation form created in Meta.
 * Forms are used in lead ads to collect user information.
 * 
 * @property meta_form_id - Meta's lead form ID
 * @property questions - JSON array of form fields/questions
 * @property page_id - Facebook Page ID the form belongs to
 */
const LeadForm = model.define("LeadForm", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_form_id: model.text(),
  name: model.text().searchable(),
  
  // Form status
  status: model.enum(["ACTIVE", "ARCHIVED", "DELETED"]).default("ACTIVE"),
  
  // Page association
  page_id: model.text(), // Facebook Page ID
  page_name: model.text().nullable(),
  
  // Form configuration
  locale: model.text().nullable(),
  
  // Form structure (JSON)
  questions: model.json().nullable(), // Array of form fields
  /*
    Example questions structure:
    [
      { "key": "email", "type": "EMAIL", "label": "Email" },
      { "key": "full_name", "type": "FULL_NAME", "label": "Full Name" },
      { "key": "phone_number", "type": "PHONE", "label": "Phone" },
      { "key": "custom_question_1", "type": "CUSTOM", "label": "How did you hear about us?" }
    ]
  */
  
  // Form content
  privacy_policy_url: model.text().nullable(),
  thank_you_page_url: model.text().nullable(),
  context_card: model.json().nullable(), // Intro card content
  
  // Follow-up
  follow_up_action_url: model.text().nullable(),
  
  // Stats
  leads_count: model.number().default(0),
  
  // Sync
  last_synced_at: model.dateTime().nullable(),
  
  // Relationships
  ad_account: model.belongsTo(() => AdAccount, { mappedBy: "lead_forms" }),
  leads: model.hasMany(() => Lead, { mappedBy: "lead_form" }),
  
  // Additional metadata
  metadata: model.json().nullable(),
})

export default LeadForm
