# MikroHyperbee — how to use it

> A short, practical guide. For the *why* (north star, strangler plan, keep/shed),
> read [`MIKROHYPERBEE_FRAMEWORK.md`](./MIKROHYPERBEE_FRAMEWORK.md). This page is
> the *how*. Landed on `main` 2026-07-15 (PRs #1046, #1050).

## What it is (in one paragraph)

`@jytextiles/mikrohyperbee` (`packages/mikrohyperbee/`) is a **storage backend for
a Medusa module** that keeps records in a local, append-friendly
[Hyperbee](https://docs.pears.com/building-blocks/hyperbee) KV store instead of
Postgres — **without changing the module's public API**. Medusa plugs storage in
at one seam (the internal per-model service that the generated
`create/list/retrieve/update/delete` methods delegate to). MikroHyperbee provides
a drop-in for that seam: a contract-driven `HyperbeeBaseRepository`. Swap it in via
a loader and the *same* route, service, `query.graph`, links, and workflows keep
working — the records just live in Hyperbee.

## What it means (why we'd want this)

- **Own the data layer** — a step toward running modules off Medusa/Postgres
  entirely (the #938 "product-as-spine" / strangler plan).
- **Append-log by construction** — great for **provenance / audit / append-mostly**
  domains (weaver census, certification #935, audit trails) where immutability and
  crash-safety are a feature, not overhead.
- **Local-first / P2P-ready** — Hypercore replicates peer-to-peer, so the same
  store can be mirrored (public + encrypted cores) without a central DB.
- **Polyglot, opt-in** — it's per-module and flag-gated. Churny/transactional
  modules (orders, carts) stay on Postgres. You only move a module when the
  append-log is a strict upgrade.

**It is NOT** a general Postgres replacement, and not for high-write transactional
data. Reach for it on append-mostly, provenance, or decentralized modules.

## Putting a module on it (the recipe)

Reference implementation: the `person_property` module
(`apps/backend/src/modules/personproperty/`). Three pieces:

**1. Declare a contract** (`dal/hyperbee-<module>-service.ts`) — describes the
model to the generic repository: fields, which to index, unique keys, idempotency,
relations. No Medusa coupling in the core; a thin Proxy maps the package's
`ContractError` → `MedusaError` for route 404/400s.

```ts
import { defineContract, hyperbeeRepositoryFor, type BeeLike } from "@jytextiles/mikrohyperbee"

export const personPropertyContract = defineContract("person_property", {
  id: { prefix: "pp" },
  mode: "lax",                              // lax = warn-and-allow shape, keep uniqueness
  fields: { profile_type: { type: "string", default: "weaver" }, census_id: { type: "string", nullable: true }, /* … */ },
  indexes: ["profile_type", "district", "region_state"],   // equality secondary indexes
  unique: ["census_id"],                                    // natural key
  idempotencyKey: (r) => (r.census_id ? `census:${r.census_id}` : undefined),
  // timestamps: true is the default — created_at/updated_at/deleted_at are stamped.
})

export function createPersonPropertyRepository(bee: BeeLike) {
  return /* toMedusaRepository( */ hyperbeeRepositoryFor(personPropertyContract, bee) /* ) */
}
```

**2. Add a flag-gated loader** (`loaders/hyperbee-dal.ts`) — when the flag is on,
open a Hyperbee store and override the module container's internal service +
`baseRepository` with the repository. Flag OFF (the default) = strict no-op, module
stays on Postgres. Register the loader in the module's `index.ts` `loaders: [...]`.

```ts
if (process.env.PERSON_PROPERTY_HYPERBEE !== "true") return   // default → Postgres
const { default: Corestore } = await import("corestore")       // native deps imported
const { default: Hyperbee }  = await import("hyperbee")        //   only when flag on
// … open store, build repo, container.register({ <model>Service: asValue(repo), baseRepository: asValue(...) })
```

**3. Flip the flag** to try it: `PERSON_PROPERTY_HYPERBEE=true` (+ optional
`PERSON_PROPERTY_HYPERBEE_STORE=./.person-property-store`). Unset = Postgres.

## Verifying a module works over Hyperbee

- **Package unit tests** (backend-free, fast): `pnpm --filter @jytextiles/mikrohyperbee test`.
- **Live boot + `query.graph` across links**: `GET /admin/person-properties/verify-link`
  (`apps/backend/src/api/admin/person-properties/verify-link/route.ts`) — creates a
  person + property, links them, traverses `query.graph` both directions, and reports
  `{ ok, backend: "hyperbee" | "postgres" }`. Copy this pattern for a new module.

## Gotchas (learned the hard way — don't relearn them)

1. **The backend imports the package's compiled `dist/`, not `src/`.** After any
   change under `packages/mikrohyperbee/src/`, run
   `pnpm --filter @jytextiles/mikrohyperbee build` **and restart the server** — dev
   hot-reloads backend `src/` but *not* a workspace package's `dist/` in the require
   cache. (`dist/` is gitignored; it's rebuilt via the `prepare` hook on install.)

2. **The `query.graph` alias for a module link is the linked MODEL name, not the
   `defineLink` `field`.** For the person↔person_property link, traverse via
   `person.person_property` (model name), even though the link declares
   `field: "properties"`. The wrong alias silently returns nothing. See
   `reference_query_graph_link_alias_is_model_name` memory.

3. **`query.graph` hydrates links with `{ id: [ids] }` (a bare array) and
   `config.take = null` (no limit).** The repository already handles both; if you
   fork the list logic, keep it — a `= 15` default only fires for `undefined`, so a
   `null` take must mean "all", never `slice(skip, skip+null) = []`.

4. **Native deps (`corestore`/`hyperbee`/`rocksdb-native`) are dynamic-imported in
   the loader**, so a build without them never breaks (flag-off is import-safe). But
   embedded P2P needs the native prebuild present in the **prod Docker image** —
   validate there, not just locally (this is why prod census reads run in a
   dedicated path, see the census notes).

## Status & next

- **On `main`:** the package + `person_property` DAL (flag-gated, default off),
  timestamps, and verified `query.graph`-across-link.
- **Next domains** to move onto it: weaver / certification (#935) provenance.
  Product stays a *stress-test*, not a first module (its raw-SQL escape hatches are
  the coupling we're shedding).
