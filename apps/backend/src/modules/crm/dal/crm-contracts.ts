/**
 * CRM write-contracts — Medusa-free. Imported by BOTH the Medusa module DAL
 * (dal/hyperbee-crm-service.ts) and the standalone CRM node (node/server.ts), so
 * the record shape, indexes, uniqueness and relations are one source of truth
 * regardless of where the store is hosted.
 */
import { defineContract, type Contract } from "@jytextiles/mikrohyperbee";

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
    last_name: { type: "string", required: true },
    email: { type: "string", nullable: true },
    phone: { type: "string", nullable: true },
    title: { type: "string", nullable: true },
    company_id: { type: "string", nullable: true },
    metadata: { type: "json", nullable: true },
  },
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
      default: "prospecting",
      enum: ["prospecting", "qualification", "proposal", "negotiation", "won", "lost"],
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

export const crmContracts: Record<string, Contract> = {
  crm_company: crmCompanyContract,
  crm_person: crmPersonContract,
  crm_opportunity: crmOpportunityContract,
  crm_note: crmNoteContract,
  crm_task: crmTaskContract,
};

/** URL path segment ↔ model name, for the node's REST surface + the proxy. */
export const CRM_MODEL_BY_SEGMENT: Record<string, string> = {
  companies: "crm_company",
  people: "crm_person",
  opportunities: "crm_opportunity",
  notes: "crm_note",
  tasks: "crm_task",
};
