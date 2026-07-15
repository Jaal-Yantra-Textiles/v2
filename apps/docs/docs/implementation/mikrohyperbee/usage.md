---
title: "Using MikroHyperbee — recipe, verify, gotchas"
sidebar_label: "Usage"
sidebar_position: 2
---

# Using MikroHyperbee

Reference implementation: the `person_property` module
(`apps/backend/src/modules/personproperty/`). See **[Overview](./overview.md)** for
what this is and when to reach for it.

## Putting a module on it (the recipe)

Three pieces:

### 1. Declare a contract

`dal/hyperbee-<module>-service.ts` describes the model to the generic repository —
fields, which to index, unique keys, idempotency, relations. The core is
Medusa‑free; a thin Proxy maps the package's `ContractError` → `MedusaError` so
routes still return the right 404/400.

```ts
import { defineContract, hyperbeeRepositoryFor, type BeeLike } from "@jytextiles/mikrohyperbee"

export const personPropertyContract = defineContract("person_property", {
  id: { prefix: "pp" },
  mode: "lax",                                   // warn-and-allow shape, keep uniqueness
  fields: {
    profile_type: { type: "string", default: "weaver" },
    census_id:    { type: "string", nullable: true },
    // …
  },
  indexes: ["profile_type", "district", "region_state"],  // equality secondary indexes
  unique: ["census_id"],                                   // natural key
  idempotencyKey: (r) => (r.census_id ? `census:${r.census_id}` : undefined),
  // timestamps: true is the default → created_at / updated_at / deleted_at are stamped.
})

export function createPersonPropertyRepository(bee: BeeLike) {
  return /* toMedusaRepository( */ hyperbeeRepositoryFor(personPropertyContract, bee) /* ) */
}
```

### 2. Add a flag‑gated loader

`loaders/hyperbee-dal.ts` — when the flag is on, open a Hyperbee store and override
the module container's internal service + `baseRepository` with the repository.
Flag **off** (the default) is a strict no‑op: the module stays on Postgres. Register
the loader in the module's `index.ts` under `loaders: [...]`.

```ts
if (process.env.PERSON_PROPERTY_HYPERBEE !== "true") return    // default → Postgres
const { default: Corestore } = await import("corestore")        // native deps imported
const { default: Hyperbee }  = await import("hyperbee")         //   only when flag on
// … open store, build repo, then:
// container.register({ personPropertyService: asValue(repo), baseRepository: asValue(...) })
```

### 3. Flip the flag to try it

```bash
PERSON_PROPERTY_HYPERBEE=true \
PERSON_PROPERTY_HYPERBEE_STORE=./.person-property-store \
yarn dev
```

Unset the flag → the module is back on Postgres. Same routes, same responses.

## Verifying a module over Hyperbee

- **Package unit tests** (backend‑free, fast):
  ```bash
  pnpm --filter @jytextiles/mikrohyperbee test
  ```
- **Live boot + `query.graph` across links**:
  `GET /admin/person-properties/verify-link`
  (`apps/backend/src/api/admin/person-properties/verify-link/route.ts`). It creates a
  person + property, links them, traverses `query.graph` **both directions**, and
  returns `{ ok, backend: "hyperbee" | "postgres" }`. Copy this route as the template
  for a new module.

## Gotchas (learned the hard way — don't relearn them)

1. **The backend imports the package's compiled `dist/`, not `src/`.** After any
   change under `packages/mikrohyperbee/src/`, run
   `pnpm --filter @jytextiles/mikrohyperbee build` **and restart the server**. Dev
   hot‑reloads backend `src/` but *not* a workspace package's `dist/` in the require
   cache. (`dist/` is gitignored; it's rebuilt via the `prepare` hook on install.)

2. **The `query.graph` alias for a module link is the linked MODEL name, not the
   `defineLink` `field`.** For the person ↔ person_property link, traverse via
   `person.person_property` (the model name) — even though the link declares
   `field: "properties"`. The wrong alias silently returns nothing.

3. **`query.graph` hydrates links with `{ id: [ids] }` (a bare array) and
   `config.take = null` (no limit).** The repository already handles both. If you
   fork the list logic, keep it: a `= 15` default only fires for `undefined`, so a
   `null` take must mean "all", never `slice(skip, skip + null) = []`.

4. **Native deps (`corestore` / `hyperbee` / `rocksdb-native`) are dynamic‑imported
   in the loader**, so a build without them never breaks (flag‑off is import‑safe).
   But embedded P2P needs the native prebuild present in the **prod Docker image** —
   validate there, not just locally.

## Status & next

- **On `main`:** the package + `person_property` DAL (flag‑gated, default off),
  timestamp stamping, and verified `query.graph`‑across‑link traversal.
- **Next domains** to move onto it: weaver / certification (#935) provenance.
  Product stays a *stress‑test*, not a first module — its raw‑SQL escape hatches are
  exactly the coupling we're shedding.
