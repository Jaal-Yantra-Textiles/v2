import { asValue } from "awilix";

import type { LoaderOptions } from "@medusajs/framework/types";

import { createCrmProxyRepositories, type CrmRepositories } from "../dal/crm-proxy";
import { createCrmRepositories } from "../dal/hyperbee-crm-service";

/**
 * CRM DAL loader. Two modes, and it is FLAG-GATED + NON-FATAL — a CRM backend
 * problem must never take down Medusa boot (it's an opt-in module, not core).
 *
 *  1. PROXY (recommended for prod) — CRM_NODE_URL set → forward every
 *     create/list/retrieve/update/delete to the always-on CRM node
 *     (modules/crm/node/server.ts), which holds the durable Autobase writer.
 *     Medusa stays stateless: no native hypercore stack in the API tasks. This is
 *     the multi-writer-ready path — offline/edge writers join the node's Autobase
 *     later with zero Medusa changes.
 *
 *  2. EMBEDDED (dev/experimental) — CRM_HYPERBEE=true → open a LOCAL Hyperbee in
 *     this process (single-writer, ephemeral on Fargate). Handy for local dev;
 *     not durable in prod.
 *
 * With neither env set the loader no-ops (module simply serves nothing until
 * configured) rather than throwing — so a missing config or a native-stack hiccup
 * degrades CRM alone instead of crashing the whole backend.
 *
 * Env: CRM_NODE_URL, CRM_NODE_TOKEN (proxy) · CRM_HYPERBEE, CRM_HYPERBEE_STORE
 * (embedded).
 */
function registerCrm(container: LoaderOptions["container"], repos: CrmRepositories) {
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
}

export default async function hyperbeeDalLoader({ container }: LoaderOptions) {
  const logger = container.resolve("logger", { allowUnregistered: true }) as
    | { info: (m: string) => void; error: (m: string) => void }
    | undefined;

  // ── Proxy mode (prod) ──────────────────────────────────────────────────────
  if (process.env.CRM_NODE_URL) {
    registerCrm(container, createCrmProxyRepositories(process.env.CRM_NODE_URL, process.env.CRM_NODE_TOKEN));
    logger?.info(`[crm] proxy mode → ${process.env.CRM_NODE_URL} (durable Autobase node)`);
    return;
  }

  // ── Embedded mode (dev/experimental), gated + non-fatal ────────────────────
  if (process.env.CRM_HYPERBEE !== "true") {
    logger?.info(
      "[crm] disabled — set CRM_NODE_URL for proxy mode, or CRM_HYPERBEE=true to embed a local store"
    );
    return;
  }
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
    registerCrm(container, repos);
    logger?.info(`[crm] embedded Hyperbee DAL active (store=${storeDir}) — single-writer, dev only`);
  } catch (e: any) {
    // NON-FATAL: log and leave CRM unconfigured; never break boot.
    logger?.error(`[crm] embedded Hyperbee DAL failed to start (module stays offline): ${e?.message || e}`);
  }
}
