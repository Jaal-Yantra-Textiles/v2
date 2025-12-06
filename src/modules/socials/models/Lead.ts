import { model } from "@medusajs/framework/utils"
import LeadForm from "./LeadForm"
import SocialPlatform from "./SocialPlatform"

/**
 * Lead (Meta Lead Ads Lead)
 * 
 * Represents a lead captured from Meta lead ads.
 * This is the CORE model for lead management.
 * 
 * @property meta_lead_id - Meta's lead ID
 * @property field_data - All form responses as JSON
 * @property status - Lead processing status (new, contacted, qualified, converted, etc.)
 */
const Lead = model.define("Lead", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_lead_id: model.text(),
  
  // ============ CONTACT INFO ============
  // Extracted from field_data for easy querying
  email: model.text().searchable().nullable(),
  phone: model.text().nullable(),
  full_name: model.text().searchable().nullable(),
  first_name: model.text().nullable(),
  last_name: model.text().nullable(),
  
  // Additional contact fields
  company_name: model.text().nullable(),
  job_title: model.text().nullable(),
  city: model.text().nullable(),
  state: model.text().nullable(),
  country: model.text().nullable(),
  zip_code: model.text().nullable(),
  
  // ============ FORM DATA ============
  // All form responses (including custom questions)
  field_data: model.json().nullable(),
  /*
    Example field_data structure:
    [
      { "name": "email", "values": ["user@example.com"] },
      { "name": "full_name", "values": ["John Doe"] },
      { "name": "phone_number", "values": ["+1234567890"] },
      { "name": "custom_question_1", "values": ["Google Search"] }
    ]
  */
  
  // ============ SOURCE TRACKING ============
  // Where the lead came from
  ad_id: model.text().nullable(),
  ad_name: model.text().nullable(),
  adset_id: model.text().nullable(),
  adset_name: model.text().nullable(),
  campaign_id: model.text().nullable(),
  campaign_name: model.text().nullable(),
  form_id: model.text().nullable(),
  form_name: model.text().nullable(),
  page_id: model.text().nullable(),
  page_name: model.text().nullable(),
  
  // Platform (facebook, instagram)
  source_platform: model.text().nullable(),
  
  // ============ TIMESTAMPS ============
  created_time: model.dateTime(), // When lead was submitted on Meta
  
  // ============ LEAD STATUS ============
  status: model.enum([
    "new",           // Just received, not yet reviewed
    "contacted",     // Reached out to lead
    "qualified",     // Qualified as a good lead
    "unqualified",   // Not a fit
    "converted",     // Became a customer
    "lost",          // Lost opportunity
    "archived"       // Archived/closed
  ]).default("new"),
  
  // ============ INTERNAL TRACKING ============
  // Notes and activity
  notes: model.text().nullable(),
  
  // Assignment
  assigned_to: model.text().nullable(), // User ID
  assigned_at: model.dateTime().nullable(),
  
  // Status timestamps
  contacted_at: model.dateTime().nullable(),
  qualified_at: model.dateTime().nullable(),
  converted_at: model.dateTime().nullable(),
  
  // Lead value
  estimated_value: model.bigNumber().nullable(),
  actual_value: model.bigNumber().nullable(),
  
  // Lead source/medium (for attribution)
  utm_source: model.text().nullable(),
  utm_medium: model.text().nullable(),
  utm_campaign: model.text().nullable(),
  
  // ============ INTEGRATION ============
  // Link to Person module (optional)
  person_id: model.text().nullable(),
  
  // External CRM sync
  external_id: model.text().nullable(), // ID in external CRM
  external_system: model.text().nullable(), // CRM name
  synced_to_external_at: model.dateTime().nullable(),
  
  // ============ RELATIONSHIPS ============
  lead_form: model.belongsTo(() => LeadForm, { mappedBy: "leads" }),
  platform: model.belongsTo(() => SocialPlatform, { mappedBy: "leads" }),
  
  // ============ METADATA ============
  // Raw data from Meta and any additional info
  metadata: model.json().nullable(),
  /*
    Example metadata:
    {
      "raw_response": { ... }, // Full Meta API response
      "retailer_item_id": "...",
      "is_organic": false,
      "platform": "fb"
    }
  */
})

export default Lead
