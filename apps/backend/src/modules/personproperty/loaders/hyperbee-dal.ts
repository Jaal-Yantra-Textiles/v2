import { asValue } from "awilix";

import type { LoaderOptions } from "@medusajs/framework/types";

import { createPersonPropertyRepository } from "../dal/hyperbee-person-property-service";

/**
 * MikroHyperbee DAL swap for the `person_property` module.
 *
 * Flag-gated + fully non-fatal. When PERSON_PROPERTY_HYPERBEE=true, this loader
 * opens a local Hyperbee-backed store and overrides the module container's
 * `personPropertyService` (the internal per-model service the generated
 * PersonPropertyService delegates to) and `baseRepository` (the serialize +
 * manager/transaction seam) with Hyperbee equivalents — so the REAL generated
 * create/list/listAndCount/retrieve/update/delete run over Hyperbee, no Postgres.
 *
 * With the flag unset (the default), this returns immediately and the module
 * keeps its normal MikroORM/Postgres DAL — so it is a strict no-op until opted in.
 *
 * The DAL logic is proven against the real service class in the MikroHyperbee
 * spike (person-property-medusa-e2e.ts, 11/11). The one seam that still needs a
 * live Medusa boot to confirm is whether this loader's container override takes
 * effect over the auto-registered internal service — hence flag-off by default.
 */
export default async function hyperbeeDalLoader({ container }: LoaderOptions) {
  const logger = container.resolve("logger", { allowUnregistered: true }) as
    | { info: (m: string) => void; error: (m: string) => void }
    | undefined;

  if (process.env.PERSON_PROPERTY_HYPERBEE !== "true") {
    return;
  }

  const storeDir =
    process.env.PERSON_PROPERTY_HYPERBEE_STORE || "./.person-property-store";

  try {
    // Native hypercore stack (corestore -> rocksdb-native) is dynamic-imported so
    // a build/runtime without the optional deps never breaks — same pattern as
    // the census reader loader.
    const [{ default: Corestore }, { default: Hyperbee }] = await Promise.all([
      import("corestore"),
      import("hyperbee"),
    ]);

    const store = new Corestore(storeDir);
    await store.ready();
    const bee = new Hyperbee(store.get({ name: "person_property" }), {
      keyEncoding: "utf-8",
      valueEncoding: "binary",
    });
    await bee.ready();

    const internal = createPersonPropertyRepository(bee);

    // For a KV store the "manager" is a no-op and a transaction runs inline; the
    // outer generated service only uses baseRepository.serialize. (Mirrors the
    // proven spike container shape.)
    const baseRepository = {
      serialize: async (d: any) => JSON.parse(JSON.stringify(d)),
      getFreshManager: () => internal,
      getActiveManager: () => internal,
      transaction: async (task: (m: any) => any) => task(internal),
    };

    container.register({
      personPropertyService: asValue(internal),
      baseRepository: asValue(baseRepository),
    });

    logger?.info(
      "[person_property] MikroHyperbee DAL active — records served from Hyperbee (PERSON_PROPERTY_HYPERBEE=true)"
    );
  } catch (e: any) {
    // Never break boot: log and leave the default Postgres DAL in place.
    logger?.error(
      `[person_property] Hyperbee DAL failed to start, falling back to Postgres: ${e?.message || e}`
    );
  }
}
