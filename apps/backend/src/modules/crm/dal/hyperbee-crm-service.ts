import { MedusaError } from "@medusajs/framework/utils";

import {
  ContractError,
  hyperbeeRepositoryFor,
  type BeeLike,
  type ModelRepository,
  type RepositoryContext,
} from "@jytextiles/mikrohyperbee";

// One source of truth for the CRM record shapes (shared with the standalone node).
export {
  crmContracts,
  crmCompanyContract,
  crmPersonContract,
  crmOpportunityContract,
  crmNoteContract,
  crmTaskContract,
} from "./crm-contracts";
import { crmContracts } from "./crm-contracts";


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
