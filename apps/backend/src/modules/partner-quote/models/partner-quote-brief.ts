import { model } from "@medusajs/framework/utils"

import PartnerQuoteBriefOption from "./partner-quote-brief-option"
import PartnerQuoteBriefQuestion from "./partner-quote-brief-question"
import PartnerQuoteBriefUpdate from "./partner-quote-brief-update"

/**
 * A quote BRIEF (#2608 S1): what a buyer sees before anything is priced.
 *
 * A `partner_quote` is a priced, payable basket from ONE partner's catalogue.
 * Made-to-order work that needs several workshops (fabric from one, print from
 * another, stitching from a third) cannot start there: nothing is priced yet,
 * some steps have no partner at all, and the buyer still has to tell us what
 * she wants. The brief is that first conversation, on a link of its own:
 *
 *   options → steps → the partners who can do each step (named, with their
 *   sample photos) → a live ESTIMATE where a rate exists, "we'll confirm"
 *   where it doesn't, "we're exploring partners" where nobody can yet;
 *   plus questions she answers, and updates we post back (sample photos).
 *
 * The LEAD partner (`partner_id`) is the seller of record and owns the store
 * the link is served from; the step partners are suppliers. Estimates are read
 * live from `partner_capability_rate` at view time and are never frozen here:
 * nothing on a brief is a price anyone has agreed to.
 */
const PartnerQuoteBrief = model.define("partner_quote_brief", {
  id: model.id({ prefix: "qbrief" }).primaryKey(),

  /** The lead partner: seller of record, owner of the storefront the link lives on. */
  partner_id: model.text(),
  /** The lead's store. The buyer route refuses any other store's key (same guard as quotes). */
  store_id: model.text(),

  customer_id: model.text().nullable(),
  buyer_email: model.text().nullable(),
  recipient_name: model.text().nullable(),
  recipient_company: model.text().nullable(),
  /** Decides the /<country>/ prefix of the link. */
  destination_country_code: model.text(),

  title: model.text(),
  /** Shown at the top of the page, in the lead's voice. */
  intro: model.text().nullable(),

  /** Currency the estimates are shown in. Rates are read in their own currency; a mismatch is shown, never converted silently. */
  currency_code: model.text().default("inr"),

  /** How many pieces the first sample run makes (e.g. 4), or null for no sample stage. */
  sample_quantity: model.number().nullable(),

  /**
   * draft → open (link minted) → submitted (buyer sent answers) → sampling
   * (pieces being made, updates posted) → quoted (a priced quote exists) → closed.
   *
   * ⚠️ CHECK constraint: a new value needs its migration.
   */
  status: model
    .enum(["draft", "open", "submitted", "sampling", "quoted", "closed"])
    .default("draft"),

  /** sha256 of the buyer's token; null while a draft, so a draft is unreachable. */
  token_hash: model.text().unique().nullable(),

  opened_at: model.dateTime().nullable(),
  submitted_at: model.dateTime().nullable(),
  expires_at: model.dateTime().nullable(),
  last_viewed_at: model.dateTime().nullable(),
  view_count: model.number().default(0),

  /** The CRM records a sent brief became (intake). Set once, on first send. */
  crm_person_id: model.text().nullable(),
  crm_opportunity_id: model.text().nullable(),

  /** The priced quote this brief became (part 3). */
  quote_id: model.text().nullable(),

  created_by: model.text().nullable(),

  options: model.hasMany(() => PartnerQuoteBriefOption, { mappedBy: "brief" }),
  questions: model.hasMany(() => PartnerQuoteBriefQuestion, { mappedBy: "brief" }),
  updates: model.hasMany(() => PartnerQuoteBriefUpdate, { mappedBy: "brief" }),

  /** Incidental only. */
  metadata: model.json().nullable(),
})

export default PartnerQuoteBrief
