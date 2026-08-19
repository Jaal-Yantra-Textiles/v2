/**
 * CRM write-contracts — Medusa-free. Imported by BOTH the Medusa module DAL
 * (dal/hyperbee-crm-service.ts) and the standalone CRM node (node/server.ts), so
 * the record shape, indexes, uniqueness and relations are one source of truth
 * regardless of where the store is hosted.
 */
import { defineContract, type Contract } from "@jytextiles/mikrohyperbee";

import {
  CRM_OPPORTUNITY_DEFAULT_STAGE,
  CRM_OPPORTUNITY_STAGES,
} from "../stages";
import {
  CRM_ACTIVITY_CHANNELS,
  CRM_ACTIVITY_DIRECTIONS,
  CRM_ACTIVITY_OUTCOMES,
  CRM_ACTIVITY_RELATED_TYPES,
  CRM_ACTIVITY_TYPES,
  CRM_ENGAGEMENT_DEFAULT_STATE,
  CRM_ENGAGEMENT_STATES,
} from "../activity";

// The stage vocabulary lives in a dependency-free leaf so the admin dashboard
// can import it without pulling the hypercore stack into a browser bundle.
// Re-exported here because this file is what the CRM node bundles.
export {
  CRM_OPPORTUNITY_STAGES,
  CRM_OPPORTUNITY_DEFAULT_STAGE,
  CRM_OPPORTUNITY_CLOSED_STAGES,
  type CrmOpportunityStage,
} from "../stages";
export {
  CRM_ACTIVITY_TYPES,
  CRM_ACTIVITY_DIRECTIONS,
  CRM_ACTIVITY_CHANNELS,
  CRM_ACTIVITY_OUTCOMES,
  CRM_ENGAGEMENT_STATES,
  type CrmActivityType,
  type CrmEngagementState,
} from "../activity";

export const crmCompanyContract = defineContract("crm_company", {
  id: { prefix: "crmco" },
  mode: "strict",
  fields: {
    name: { type: "string", required: true },
    website: { type: "string", nullable: true },
    industry: { type: "string", nullable: true },
    size: { type: "string", nullable: true },
    region: { type: "string", nullable: true },
    metadata: { type: "json", nullable: true },
  },
  indexes: ["name", "industry", "region"],
  unique: ["name"],
});

export const crmPersonContract = defineContract("crm_person", {
  id: { prefix: "crmp" },
  mode: "strict",
  fields: {
    first_name: { type: "string", required: true },
    // NOT required. Every one of the 230 production ad-leads arrives with only
    // a `full_name`, and many are a single token with no surname at all
    // ("SukhdevDhiman"). Requiring it would have meant writing `""` into all of
    // them — which the contract's `required` check permits, since it only
    // rejects `undefined`. Absent stays absent.
    last_name: { type: "string", nullable: true },
    email: { type: "string", nullable: true },
    phone: { type: "string", nullable: true },
    title: { type: "string", nullable: true },
    company_id: { type: "string", nullable: true },

    // ── Engagement (the CONVERSATION axis) ──────────────────────────────────
    // A CACHE of `deriveEngagement`, never an independent source of truth:
    // only the recorder and the sweep write these, always from the activity
    // log. A hand-edited engagement state is precisely the field that ends up
    // claiming `awaiting_reply` about somebody who replied three weeks ago.
    // Indexed because the flows select on it ("everyone at follow_up_due").
    engagement_state: {
      type: "string",
      default: CRM_ENGAGEMENT_DEFAULT_STATE,
      enum: [...CRM_ENGAGEMENT_STATES],
    },
    last_activity_at: { type: "string", nullable: true },
    last_inbound_at: { type: "string", nullable: true },
    last_outbound_at: { type: "string", nullable: true },
    // Explicitly scheduled, by a human or a flow. Distinct from the derived
    // state: this is the instruction, `follow_up_due` is it having come round.
    next_follow_up_at: { type: "string", nullable: true },

    metadata: { type: "json", nullable: true },
  },
  // NOTE: `engagement_state` is deliberately NOT indexed.
  //
  // Indexes here are written at put-time (`idx.put(field/value/key)`), and the
  // package has no reindex. A field added to this list is therefore absent from
  // the index for every row written BEFORE the change — and `candidateKeys`
  // prefers the index whenever a filter names an indexed field, so
  // `{engagement_state: "not_contacted"}` would silently MISS every pre-existing
  // contact instead of scanning for them.
  //
  // Leaving it unindexed makes that query fall through to a full scan + in-memory
  // `matches()`, which is correct for old and new rows alike. At CRM volume
  // (hundreds of contacts) the scan is free; a wrong answer about who still
  // needs contacting is not. Index it only alongside a backfill that rewrites
  // every row.
  indexes: ["email", "last_name", "company_id"],
  unique: ["email"],
  relations: {
    company: {
      kind: "belongsTo",
      key: "company_id",
      target: "crm_company",
      integrity: "soft",
    },
  },
});

export const crmOpportunityContract = defineContract("crm_opportunity", {
  id: { prefix: "crmo" },
  mode: "strict",
  fields: {
    title: { type: "string", required: true },
    stage: {
      type: "string",
      default: CRM_OPPORTUNITY_DEFAULT_STAGE,
      enum: [...CRM_OPPORTUNITY_STAGES],
    },
    amount: { type: "number", nullable: true },
    currency: { type: "string", default: "INR" },
    expected_close_date: { type: "string", nullable: true },
    company_id: { type: "string", nullable: true },
    owner_person_id: { type: "string", nullable: true },
    metadata: { type: "json", nullable: true },
  },
  indexes: ["company_id", "stage", "owner_person_id"],
  relations: {
    company: { kind: "belongsTo", key: "company_id", target: "crm_company", integrity: "soft" },
    owner: { kind: "belongsTo", key: "owner_person_id", target: "crm_person", integrity: "soft" },
  },
  invariants: [(r) => r.amount == null || r.amount >= 0 || "amount must be >= 0"],
});

export const crmNoteContract = defineContract("crm_note", {
  id: { prefix: "crmn" },
  mode: "strict",
  fields: {
    body: { type: "string", required: true },
    author: { type: "string", nullable: true },
    related_type: { type: "string", nullable: true, enum: ["person", "company", "opportunity", "task"] },
    related_id: { type: "string", nullable: true },
    metadata: { type: "json", nullable: true },
  },
  indexes: ["related_type", "related_id"],
});

export const crmTaskContract = defineContract("crm_task", {
  id: { prefix: "crmt" },
  mode: "strict",
  fields: {
    title: { type: "string", required: true },
    description: { type: "string", nullable: true },
    due_date: { type: "string", nullable: true },
    status: { type: "string", default: "pending", enum: ["pending", "in_progress", "completed", "cancelled"] },
    priority: { type: "string", default: "medium", enum: ["low", "medium", "high"] },
    assignee_person_id: { type: "string", nullable: true },
    related_type: { type: "string", nullable: true, enum: ["person", "company", "opportunity"] },
    related_id: { type: "string", nullable: true },
    metadata: { type: "json", nullable: true },
  },
  indexes: ["assignee_person_id", "status", "due_date", "related_type", "related_id"],
  relations: {
    assignee: { kind: "belongsTo", key: "assignee_person_id", target: "crm_person", integrity: "soft" },
  },
});

/**
 * The interaction log — every touch with a contact, company or deal.
 *
 * A Hyperbee contract like the other five: NO Postgres table, no migration, no
 * DML model. It lives in the same Autobase store on the CRM node, so a
 * contact and its timeline are one store and one replication unit.
 *
 * Shape mirrors `production_run_activity` (already proven for run timelines)
 * rather than inventing a second idiom: coarse `activity_type`, fine `kind`,
 * an actor, an optional message correlation, a computed `summary` and a
 * `payload` for type-specific extras.
 *
 * Two things it deliberately does NOT do:
 *
 *  - It does not duplicate `messaging_message`. Transport truth (queued/sent/
 *    delivered/read/failed) stays there; `message_id` is a plain correlation
 *    id — no foreign key, nothing joined. Copying the status here would create
 *    two records of one fact, free to disagree.
 *  - It does not replace `crm_note`. A note is human commentary; an activity is
 *    something that happened, with a direction and a time. Notes stay notes.
 *
 * `occurred_at` is when the interaction happened, which is NOT `created_at` —
 * an inbound message is usually recorded after the fact, and back-dating it is
 * the whole point of having both.
 */
export const crmActivityContract = defineContract("crm_activity", {
  id: { prefix: "crma" },
  mode: "strict",
  fields: {
    related_type: {
      type: "string",
      required: true,
      enum: [...CRM_ACTIVITY_RELATED_TYPES],
    },
    related_id: { type: "string", required: true },

    activity_type: {
      type: "string",
      required: true,
      enum: [...CRM_ACTIVITY_TYPES],
    },
    /** Fine-grained type within the bucket, e.g. "reply", "quote_sent". */
    kind: { type: "string", nullable: true },

    direction: {
      type: "string",
      default: "internal",
      enum: [...CRM_ACTIVITY_DIRECTIONS],
    },
    channel: { type: "string", nullable: true, enum: [...CRM_ACTIVITY_CHANNELS] },

    subject: { type: "string", nullable: true },
    body: { type: "string", nullable: true },
    /** One-line timeline text, computed at write time. */
    summary: { type: "string", nullable: true },

    actor_type: {
      type: "string",
      default: "system",
      enum: ["system", "admin", "contact", "flow"],
    },
    actor_id: { type: "string", nullable: true },

    // Correlation with the messaging module — an id, not a relation.
    message_id: { type: "string", nullable: true },
    template_name: { type: "string", nullable: true },
    recipient: { type: "string", nullable: true },
    outcome: { type: "string", nullable: true, enum: [...CRM_ACTIVITY_OUTCOMES] },

    occurred_at: { type: "string", required: true },
    payload: { type: "json", nullable: true },
  },
  indexes: ["related_type", "related_id", "direction", "channel", "activity_type"],
});

export const crmContracts: Record<string, Contract> = {
  crm_company: crmCompanyContract,
  crm_person: crmPersonContract,
  crm_opportunity: crmOpportunityContract,
  crm_note: crmNoteContract,
  crm_task: crmTaskContract,
  crm_activity: crmActivityContract,
};

/** URL path segment ↔ model name, for the node's REST surface + the proxy. */
export const CRM_MODEL_BY_SEGMENT: Record<string, string> = {
  companies: "crm_company",
  people: "crm_person",
  opportunities: "crm_opportunity",
  notes: "crm_note",
  tasks: "crm_task",
  activities: "crm_activity",
};
