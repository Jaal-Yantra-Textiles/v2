import { MedusaError } from "@medusajs/framework/utils";

import {
  ContractError,
  defineContract,
  hyperbeeRepositoryFor,
  type BeeLike,
  type Contract,
  type ModelRepository,
  type RepositoryContext,
} from "@jytextiles/mikrohyperbee";

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
      enum: [
        "prospecting",
        "qualification",
        "proposal",
        "negotiation",
        "won",
        "lost",
      ],
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
    company: {
      kind: "belongsTo",
      key: "company_id",
      target: "crm_company",
      integrity: "soft",
    },
    owner: {
      kind: "belongsTo",
      key: "owner_person_id",
      target: "crm_person",
      integrity: "soft",
    },
  },
  invariants: [
    (r) =>
      r.amount == null || r.amount >= 0 || "amount must be >= 0",
  ],
});

export const crmNoteContract = defineContract("crm_note", {
  id: { prefix: "crmn" },
  mode: "strict",
  fields: {
    body: { type: "string", required: true },
    author: { type: "string", nullable: true },
    related_type: {
      type: "string",
      nullable: true,
      enum: ["person", "company", "opportunity", "task"],
    },
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
    status: {
      type: "string",
      default: "pending",
      enum: ["pending", "in_progress", "completed", "cancelled"],
    },
    priority: {
      type: "string",
      default: "medium",
      enum: ["low", "medium", "high"],
    },
    assignee_person_id: { type: "string", nullable: true },
    related_type: {
      type: "string",
      nullable: true,
      enum: ["person", "company", "opportunity"],
    },
    related_id: { type: "string", nullable: true },
    metadata: { type: "json", nullable: true },
  },
  indexes: ["assignee_person_id", "status", "due_date", "related_type", "related_id"],
  relations: {
    assignee: {
      kind: "belongsTo",
      key: "assignee_person_id",
      target: "crm_person",
      integrity: "soft",
    },
  },
});

export const crmContracts: Record<string, Contract> = {
  crm_company: crmCompanyContract,
  crm_person: crmPersonContract,
  crm_opportunity: crmOpportunityContract,
  crm_note: crmNoteContract,
  crm_task: crmTaskContract,
};

const ERROR_MAP: Record<ContractError["type"], string> = {
  not_found: MedusaError.Types.NOT_FOUND,
  invalid_data: MedusaError.Types.INVALID_DATA,
  not_unique: MedusaError.Types.INVALID_DATA,
  not_allowed: MedusaError.Types.NOT_ALLOWED,
};

const WRAPPED = new Set([
  "create",
  "retrieve",
  "list",
  "listAndCount",
  "update",
  "upsert",
  "delete",
  "softDelete",
  "restore",
]);

function toMedusaRepository(repo: ModelRepository): ModelRepository {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function" && WRAPPED.has(prop as string)) {
        return async (...args: any[]) => {
          try {
            return await (value as (...a: any[]) => any).apply(target, args);
          } catch (e) {
            if (e instanceof ContractError) {
              throw new MedusaError(
                ERROR_MAP[e.type] ?? MedusaError.Types.UNEXPECTED_STATE,
                e.message
              );
            }
            throw e;
          }
        };
      }
      return value;
    },
  }) as ModelRepository;
}

export interface CrmRepositories {
  crmCompanyService: ModelRepository;
  crmPersonService: ModelRepository;
  crmOpportunityService: ModelRepository;
  crmNoteService: ModelRepository;
  crmTaskService: ModelRepository;
}

export function createCrmRepositories(bee: BeeLike): CrmRepositories {
  // Each entity gets its own sub-bee so the rec/idx/uniq/idemp/meta sub-dbs (and
  // the persisted seq counter) are isolated per model. Sharing one bee would
  // merge all records into one `rec` namespace, cross-link indexes, and share
  // one id sequence across entities.
  const raw: Record<string, ModelRepository> = {};
  for (const [model, contract] of Object.entries(crmContracts)) {
    raw[model] = hyperbeeRepositoryFor(contract, bee.sub(model) as BeeLike);
  }

  const ctx: RepositoryContext = {
    exists: async (model: string, id: string): Promise<boolean> => {
      const repo = raw[model];
      if (!repo) return false;
      try {
        await repo.retrieve(id);
        return true;
      } catch {
        return false;
      }
    },
  };

  // Re-bind with the cross-entity exists() resolver (soft relations ignore it,
  // but flipping any relation to "strict" enforces across the shared store).
  for (const [model, contract] of Object.entries(crmContracts)) {
    raw[model] = hyperbeeRepositoryFor(contract, bee.sub(model) as BeeLike, ctx);
  }

  const wrapped: Record<string, ModelRepository> = {};
  for (const [model, repo] of Object.entries(raw)) {
    wrapped[model] = toMedusaRepository(repo);
  }

  return {
    crmCompanyService: wrapped.crm_company,
    crmPersonService: wrapped.crm_person,
    crmOpportunityService: wrapped.crm_opportunity,
    crmNoteService: wrapped.crm_note,
    crmTaskService: wrapped.crm_task,
  };
}
