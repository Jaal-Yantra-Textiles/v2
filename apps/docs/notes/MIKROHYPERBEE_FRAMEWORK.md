# MikroHyperbee — a Hyperbee-backed DAL and the path off Medusa

> **Status (2026-07-15):** seam verified end-to-end; package `packages/mikrohyperbee/`
> being scaffolded. This is the design-of-record. Related memory: the
> `handloom / hyperbee / MikroHyperbee` topic and `#938 product-as-spine`.

## 1. North star — learn from, don't clone; strangle, don't rewrite

The goal is **not** to reproduce Medusa's exact data structures/APIs so they keep
working. It is to **learn from Medusa's patterns** and build our **own resilient
framework** on an append-log + P2P foundation, then **move off Medusa
incrementally** — a strangler-fig, never a big-bang rewrite ("resilient rather
than breaking everything apart").

So the design question at every step is: *which Medusa pattern is worth carrying
forward, and which is Postgres-coupling to shed?*

The endgame is a standalone framework — our own model→CRUD codegen + a
`query.graph`-style joiner + a thin HTTP layer — that **Medusa imports today and a
Medusa-free app imports tomorrow.** Same repository code powers both. "Moving
away" becomes deleting an import, not un-forking a fork.

## 2. The one decision that unlocks it: replace at the seam, never fork the source

Medusa is built so you don't fork each writer — every writer funnels through **one
swappable interface**. There are two, and both are already swappable:

- **Seam A — `RepositoryService` / `baseRepository`** (the module DAL). Every
  `MedusaService`'s generated CRUD delegates to an internal `${model}Service`,
  which delegates to an injected repository implementing a fixed interface:
  `find / findAndCount / create / update / delete / upsert / softDelete / restore
  / serialize / transaction / getFreshManager / getActiveManager`. Satisfy that
  interface and the service, links, `query.graph`, and workflow steps above it
  never know the store changed.
- **Seam B — `DistributedTransactionStorage`** (workflow persistence,
  `get / save / scheduleRetry / scheduleStepTimeout / clearExpiredExecutions`,
  injected via `DistributedTransaction.setStorage`). Independent of Seam A.

**Do NOT patch Medusa's source.** Forking inherits merge conflicts on every
release and *deepens* coupling — the opposite of the goal. Read Medusa's source as
a *pattern reference* for the one thing we rebuild (codegen + joiner); replace
everything else at the seam.

### The seam is verified (2026-07-15)

The module's flag-gated loader override provably beats Medusa's auto-registered
internal service, two ways:

- **By construction:** `@medusajs/modules-sdk` `prepareLoaders`
  (`dist/loaders/utils/load-internal.js:465-500`) pushes `connectionLoader` →
  `containerLoader` (registers the internal service + `baseRepository`) → **then
  the module's custom loaders LAST**. `runLoaders` runs them in array order, so
  our `container.register({ personPropertyService: asValue, baseRepository:
  asValue })` clobbers the defaults. The outer module service resolves the
  internal one lazily from its cradle → gets ours.
- **Empirically:** `apps/backend/src/modules/personproperty/__tests__/hyperbee-boot-verify.ts`
  boots only that module through the real `MedusaModule.bootstrap` pipeline —
  no app, no HTTP, **no Postgres** (pass `declaration.options.manager = {}` so the
  MikroORM connection loader registers the stub and returns before connecting).
  **8/8 pass**: the internal service is `HyperbeePersonPropertyService`, the
  generated `create/listAndCount` round-trip over Hyperbee, the store is written
  to disk, zero PG.

## 3. Keep / shed

**KEEP** (storage-agnostic, resilient):

| Pattern | Why it survives | On our foundation |
|---|---|---|
| The narrow `RepositoryService` contract | It *is* the decoupling | Our `HyperbeeBaseRepository` |
| `query.graph` / RemoteJoiner | Joins are a fetch-callback, not SQL | Reuse the pattern over any store |
| Module isolation | Each module owns its data | Each module = its own core / sub-db |
| `defineLink` links as pivot records | Associations without FKs | Pivot entries + reverse index |
| Workflow = orchestration + append journal | The execution log is already append-only | Native to Hyperbee (spike M4) |
| DML model-def → generated CRUD | Declare model, get CRUD + indexes | Build our own generator |

**SHED** (Postgres baggage): raw knex/SQL escape hatches (→ CQRS projection
catalogs); MikroORM entity-manager; transactions-as-rollback (→ append-log
status-flip); the single-central-DB assumption; query-time SQL joins (→ maintained
read-models).

**RESILIENCE we gain that Medusa can't:** append-only/immutable log (audit +
crash-safety + provenance *by construction* — the #935 certification story);
local-first / P2P (no SPOF, offline, verifiable-without-disclosure via dual
public/encrypted cores); CQRS read-models over a query planner; narrow swappable
seams per subsystem.

## 4. Schema-flexibility: the model becomes a write-contract, not a storage schema

Postgres enforced the model as **DDL** — the DB physically rejects off-schema
rows. Hyperbee is schema-flexible, so the model becomes a **write-time contract**
the repository applies. That relocation is where the benefits and the risks live.

**Benefits:** additive change needs no migration (schema-on-read); heterogeneous /
sparse records are free (the ~50-field census record varies by state/source);
multiple schema versions coexist (a v1 and v3 record live side by side, the model
is a *lens*); faster iteration during the migration.

**Cost:** you lose `NOT NULL / UNIQUE / FK / CHECK` for free. Integrity must move
to the **write path**. That is not optional — it is the tax of leaving the DB.

## 5. The contract — a staged write pipeline

Integrity is enforced at the repository boundary as an **ordered pipeline**, each
stage derived from the model/link metadata where possible, each with a strictness
mode (`strict | soft | off`) the module dials per domain.

| Stage | Does | Source | Default (provenance) |
|---|---|---|---|
| 1. **Shape** | types, required, enum, defaults, coercion | DML model | strict on declared fields, open for the rest |
| 2. **Identity** | id gen/prefix, natural-key derivation | model | strict |
| 3. **Uniqueness** | natural keys + 1:1 endpoints (unique index) | contract | strict on natural key |
| 4. **Referential** | FK/link targets exist; cardinality | model + links | **soft** |
| 5. **Invariants** | cross-field CHECK-like rules | declared | lax |
| 6. **Commit** | append txn: one atomic batch writes record + secondary + unique + link indexes | — | — |
| (wrap) **Idempotency** | dedupe on natural key so re-ingest doesn't double-write | contract | on |

Relationships are **not a separate subsystem** — they are stages 3–4 of the same
contract:

- **within-module `belongsTo`** = an FK field (shape + referential stages) + a
  secondary index for reverse traversal; **`hasMany`** = the derived reverse read,
  nothing stored.
- **cross-module link** = a pivot record `{left_id, right_id}` with its own tiny
  contract; **cardinality** (1:1 / 1:n / n:m) = uniqueness on the endpoint(s), so
  it reuses stage 3.
- **cascade** = tombstone/status-flip propagation OR read-time filtering (prefer
  read-time filter for append-log purity).

**Distributed caveat:** a link can replicate before the record it points to, and
hard cross-writer referential checks need coordination we don't want. So the
resilient default is **soft / eventual referential integrity** — dangling
tolerated, resolved at read — exactly how Medusa's own cross-module links behave.
Reserve **hard** integrity for within-a-single-writer domains. Soft-by-default is
the *more* robust choice, not a compromise.

### Contract example

```ts
defineContract("person_property", {
  shape:   { from: PersonProperty },          // types/required/enum from the DML model
  id:      { prefix: "pp" },
  unique:  ["person_id"],                      // 1:1 with person
  indexes: ["district", "region_state", "profile_type", "social_group"],
  relations: {
    person: { kind: "belongsTo", key: "person_id",
              target: "person", integrity: "soft" },
  },
  idempotencyKey: (r) => r.census_id,
  mode: "lax",                                 // provenance domain → flexible
})
```

## 6. Polyglot by design

Match the store to the domain's consistency needs — do not reflexively re-impose
Postgres rigidity:

- **Provenance / append-mostly** (weaver, audit, certification, person_property):
  Hyperbee. Schema-on-read + soft referential integrity + immutability. The
  append-log *is* the integrity model. These move first.
- **Transactional / invariant-critical** (orders, carts, inventory, money): keep
  on Postgres until (and unless) the framework is mature. Keeping them on PG is a
  *feature*, not a defeat.

## 7. Package plan — `packages/mikrohyperbee/`

A plain TypeScript library (not a Medusa plugin) — the whole point is it does not
depend on Medusa. Consumed by the backend today via a per-module loader; by a
standalone runtime later.

- **Step 0 — seam verified.** ✅ Done (§2).
- **Step 1 — extract the package.** `HyperbeeBaseRepository` implementing the full
  `RepositoryService` surface (generalized from the proven
  `HyperbeePersonPropertyService`), the model→index derivation, the append-log txn
  primitives, and the staged contract (§5). A `hyperbeeRepositoryFor(contract)`
  factory + a one-line Medusa loader factory. Standalone tsx tests (no Medusa, no
  PG). **← in progress.**
- **Step 2 — first real module on it.** Move `person_property` (and the weaver
  provenance domain) onto the package behind the existing flag. Prove
  `query.graph`-across-the-`person` link on a real MedusaApp boot.
- **Step 3 — durable execution over Hyperbee.** A `store:true` workflow whose
  module DAL is the package — the `workflow_execution` journal on the append-log,
  single-node, crash/resume, zero Postgres in the loop (Seam B).
- **Later — the standalone runtime.** Grow the package's own thin HTTP + joiner so
  a module runs without Medusa; lift modules across the boundary one at a time.
  Medusa becomes optional, not load-bearing.

### Interface shape (target)

```ts
// storage-agnostic: caller provides a ready Hyperbee (or the loader opens one)
const repo = hyperbeeRepositoryFor(personPropertyContract, bee)
// implements RepositoryService: create/find/findAndCount/update/delete/upsert/
// softDelete/restore/serialize/transaction/getFreshManager/getActiveManager
```

## 8. Proven groundwork (the spike, M3–M6)

- **M3** — `HyperbeeBaseRepository` over Hyperbee sub-dbs + auto secondary indexes
  + a tiny query planner; `query.graph` across a module link; a workflow
  step+compensation. 19/19.
- **M4** — append-only transactions as a *status log* (not rollback) + Autobase
  multi-writer + visibility-gated secondary index (projection catalog). 23/23.
- **M5** — batch atomicity, concurrent LWW, crash-recovery, compound+range index,
  30× indexed-query perf at 2k rows. 59/59 across the suite.
- **M6** — the REAL Medusa `PersonPropertyService` generated methods running over
  Hyperbee, no Postgres. 11/11. Re-homed into the backend module DAL.
- **Step 0** — that DAL proven to win at real Medusa module boot. 8/8.
