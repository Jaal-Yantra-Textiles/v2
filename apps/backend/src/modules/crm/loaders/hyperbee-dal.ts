import { asValue } from "awilix";

import type { LoaderOptions } from "@medusajs/framework/types";

import { createCrmRepositories } from "../dal/hyperbee-crm-service";

/**
 * MikroHyperbee DAL for the `crm` module — the ONLY backend for CRM records.
 * No Postgres tables, no MikroORM. All CRM entities (companies, people,
 * opportunities, notes, tasks) are served from a local Hyperbee store.
 *
 * On boot this opens a Corestore/Hyperbee and overrides the module container's
 * per-model internal services + baseRepository with Hyperbee-backed equivalents,
 * so the REAL generated create/list/listAndCount/retrieve/update/delete run over
 * Hyperbee. The DML models in ../models/* stay (they drive the generated method
 * names + query.graph projection) but are never persisted to Postgres — no
 * migration is shipped for this module.
 *
 * CRM_HYPERBEE_STORE overrides the on-disk store location (default
 * ./.crm-store). On failure there is no fallback, so the error is logged and
 * re-thrown so boot fails loudly rather than silently serving nothing.
 */
export default async function hyperbeeDalLoader({ container }: LoaderOptions) {
  const logger = container.resolve("logger", { allowUnregistered: true }) as
    | { info: (m: string) => void; error: (m: string) => void }
    | undefined;

  const storeDir = process.env.CRM_HYPERBEE_STORE || "./.crm-store";

  try {
    const [{ default: Corestore }, { default: Hyperbee }] = await Promise.all([
      import("corestore"),
      import("hyperbee"),
    ]);

    const store = new Corestore(storeDir);
    await store.ready();

    const repos = createCrmRepositories(
      new Hyperbee(store.get({ name: "crm" }), {
        keyEncoding: "utf-8",
        valueEncoding: "binary",
      }) as any
    );

    const baseRepository = {
      serialize: async (d: any) => JSON.parse(JSON.stringify(d)),
      getFreshManager: () => repos,
      getActiveManager: () => repos,
      transaction: async (task: (m: any) => any) => task(repos),
    };

    container.register({
      crmCompanyService: asValue(repos.crmCompanyService),
      crmPersonService: asValue(repos.crmPersonService),
      crmOpportunityService: asValue(repos.crmOpportunityService),
      crmNoteService: asValue(repos.crmNoteService),
      crmTaskService: asValue(repos.crmTaskService),
      baseRepository: asValue(baseRepository),
    });

    logger?.info(
      "[crm] MikroHyperbee DAL active — all CRM records served from Hyperbee"
    );
  } catch (e: any) {
    logger?.error(
      `[crm] Hyperbee DAL failed to start: ${e?.message || e}`
    );
    throw e;
  }
}
