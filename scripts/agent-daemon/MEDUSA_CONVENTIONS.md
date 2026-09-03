# Medusa conventions — the rules an agent MUST follow in this repo

**Part A** (below) is this repo's hard-won corrections — every line a defect that
already reached a branch or production here. **Part B** (at the end) is the
upstream framework contract from docs.medusajs.com — file placement, middleware
matching, and the workflow-definition rules. Read BOTH before writing code.

---

# Part A — this repo's hard-won rules

Every one of these was learned by shipping something broken. They are not style
preferences; each line below is a defect that reached a branch or production.
Read this file in full before writing a route, a validator, a model, or a query.

---

## 1. Validators

```ts
const wrapSchema = <T extends z.ZodType>(schema: T) =>
  z.preprocess((obj) => obj, schema) as any
```

- Use `wrapSchema()` with `validateAndTransformBody()` — it is the house pattern
  and CLAUDE.md requires it.
- ⚠️ **`wrapSchema` is effectively a no-op**, and Medusa's `zodValidator` forces
  `.strict()` on your schema regardless. An unlisted field is rejected with
  `Unrecognized fields: 'x'` — so **every** field a client sends must be declared.
- 🔴 **Validators are registered at BOOT.** Editing a validator does NOT
  hot-reload. The dev server keeps serving the OLD schema and answers a 400 on a
  field you just added. **Restart before believing a 400.** The admin UI *does*
  hot-reload, so the field appears on screen while the API still rejects it.
- 🔴 **`.optional()` in zod over a `NOT NULL` column is a 500, not a 400.** The
  request passes validation, then the insert violates the constraint. The
  response is an HTML body with no field name — diagnosable only from logs. If
  you make a field optional, the column must become nullable **in a migration**,
  or the route must supply a default before the write.
- Prefer `> 0` over `!= null` for numeric guards: `0` is not `null`, and
  `Number(null)` is `0`. Test the RAW field before anything coerces it.
- `''` passes a `is not null` check. If empty string is invalid, say `.min(1)`.

## 2. Routes

- `export const GET/POST/...` taking `(req: MedusaRequest, res: MedusaResponse)`.
  Read the validated body from `req.validatedBody`, never re-parse.
- Errors are `throw new MedusaError(MedusaError.Types.NOT_FOUND, "...")` — never
  a bare `throw new Error`, never `res.status(404).json(...)` by hand.
- 🔴 **A new partner route 401s until `src/api/middlewares.ts` names it.** Auth
  is per-route. tsc is silent, the test suite is silent, and the route answers
  401 forever. If you add a route under a partner path, you MUST add its
  matcher entry in the same change.
- **Validate BOTH ends of any request that names an id.** Checking the id in the
  URL and trusting ids in the BODY is how one tenant reads another's data. The
  callee must refuse — do not rely on the caller having filtered.
- Medusa already parses `urlencoded`; adding a second body parser HANGS the
  request. Default body limit is 100 kB.

## 3. Models & migrations

- `model.define("name", { id: model.id().primaryKey(), ... })` from
  `@medusajs/framework/utils`.
- 🔴 **DO NOT WRITE OR GENERATE A MIGRATION.** Migrations are excluded from
  delegation. A generated migration in this repo **re-emits columns that
  hand-written migrations already added**: its `up` is idempotent, but its
  `down` DROPS another migration's columns. If your change needs a schema
  change, make the model change and report the required migration under
  `NOT-DONE:` — a human writes it.
- Two modules with the same migration NAME ⇒ the second never runs, silently.
- A link column declared `{ type: "decimal" }` is `numeric(10,0)` — scale zero.
  It will round 11.8 to 12. Never store a fractional amount that way.

## 4. Reading data — services vs `query.graph`

- 🔴 **A module-service route CANNOT resolve links.** `service.listX({ relations })`
  silently IGNORES `?fields=rel.id`. You get no error and no key — just missing
  data. Only `query.graph` expands links.
- On a `query.graph` route an unknown relation is silently DROPPED, while a real
  but empty one returns `[]`. Absence of a key means you asked wrong, not that
  the data is empty.
- 🔴 **Query a link from its `Link.entryPoint`, not from the entity.** A
  `query.graph` from an ENTITY to a linked field returns NO KEY, silently.
- A `query.graph` to-ONE link is an **object**; to-MANY is an **array**. Calling
  `.filter` on the to-one 500s.
- `query.graph` cannot reach into JSON subkeys. A number written inside a
  `metadata` blob is a number nothing can query, filter, or aggregate. If a
  value needs to be read back, it needs a column.
- An empty relation can come back as one ALL-NULL row rather than zero rows.

## 5. Writing data

- 🔴 **`updateX({ id, ...fields })` means DIFFERENT things on a custom module
  service and on a CORE one. Check which you are calling before you touch it.**
  - On a **custom module service** (one that extends `MedusaService`), the
    generated `updateX` **does** have a single-object entity form:
    `updateX({ id, ...fields })` updates that row by id and returns an OBJECT.
    This is correct and is the house pattern — do not "fix" it.
  - On a **core module service** (`StoreModuleService`, etc.) there is **no**
    entity form. The overloads are `updateX(id, data)` and
    `updateX(selector, data)`, so one flat object binds to `selector` with
    `data === undefined`: it matches nothing, writes nothing, returns `[]`, and
    **throws nothing**. This shipped a live bug — deleting a partner's default
    region left the store pointing at a deleted region.
  - ✅ On a core service write `updateX(id, { ...fields })`, or the explicit
    `updateX({ selector: { id }, data: { ...fields } })`.
  - 🔑 **Never conclude this from the call shape alone — read the service's
    `.d.ts` or its `MedusaService` base.** An adversarial reviewer flagged a
    correct custom-module call as this bug because an earlier version of this
    very file stated the rule absolutely. Two call sites with identical syntax
    can be one correct and one broken.
- `updateX` returns an OBJECT (not an array) for the entity form.
- 🔴 **`filters: { id: undefined }` means NO FILTER — every row — not "no rows".**
  Guard the id before it reaches a filter.
- `link.create` is **not idempotent**. Calling it twice creates two links.
- A hook that returns a plain object DISCARDS its answer.
- `metadata` is not a contract. Do not put a value there that a payout, a price,
  or a decision will later read.

## 6. Workflows

- `createStep(name, invoke, compensate)` / `createWorkflow(name, fn)` returning
  `new WorkflowResponse(...)`; steps return `new StepResponse(...)`.
- Always write the compensation function. A step that cannot be undone must say
  so explicitly rather than silently omitting it.
- 🔴 A workflow `await` cannot outlive **24.85 days** (Node's `setTimeout` cap).
- A long in-process loop does NOT survive a deploy: the step is
  `async, backgroundExecution`, so the engine waits forever for a callback from
  a process that no longer exists, and `status` still reads `running`. Derive a
  resumable work-list from STATE (what has no result yet), never from "what
  failed" — items never attempted are not failures.

## 7. Naming & structure

| thing | convention |
|---|---|
| files | kebab-case (`company-service.ts`) |
| classes | PascalCase (`CompanyService`) |
| variables/functions | camelCase |
| constants | SCREAMING_SNAKE_CASE (`COMPANY_MODULE`) |
| interfaces | PascalCase, no `I` prefix |

Import order: external (`@medusajs/*`, `zod`, …) → internal (`@/*`) → relative.

Module layout: `src/modules/{module}/` with `index.ts` (the `Module()` export),
`models/`, `service.ts` (extends `MedusaService`), `migrations/`, `__tests__/`.

## 8. Amounts

Medusa 2.x amounts are **DECIMAL**. There is no cents multiply. A `×100` in a
price path is a bug — it has already shipped one design listed at 100× its price.

---

# Part B — Framework rules from docs.medusajs.com

Part A above is *this repo's* hard-won corrections. Part B is the **upstream
framework contract**: break one of these and the file is not registered, the
route does not exist, or the workflow silently does nothing. Sourced from
docs.medusajs.com.

## B1. File placement is the registration mechanism

Nothing here is registered by an import. Medusa discovers code **by where the
file sits and what it is called**. A file in the wrong place is not a broken
feature — it is an absent one, with no error anywhere.

| what | where it MUST live | exact filename |
|---|---|---|
| API route | `src/api/<path>/` | **`route.ts`** — no other name works |
| Middleware | `src/api/` root ONLY | **`middlewares.ts`** |
| Workflow | `src/workflows/` | any; default-export the workflow |
| Module | `src/modules/<name>/` | `index.ts` + `service.ts` + `models/` |
| Subscriber | `src/subscribers/` | any; default-export the handler |
| Scheduled job | `src/jobs/` | any; default-export the job |

- The directory path **is** the URL. `src/api/admin/quotes/route.ts` serves
  `/admin/quotes`. There is no route table to add to.
- A dynamic segment is a **bracketed directory**: `/admin/quotes/:id` is
  `src/api/admin/quotes/[id]/route.ts`, read as `req.params.id`. Nest for more:
  `src/api/hello/[id]/name/[name]/route.ts` → `/hello/:id/name/:name`.
- A route file must export at least one HTTP-method handler by name:
  `export const GET = (req: MedusaRequest, res: MedusaResponse) => {}`. A
  default export is not a route.
- ⚠️ **`middlewares.ts` must sit at the ROOT of `src/api`, spelled exactly.**
  The docs call a misspelling "a common mistake that can lead to the middleware
  not being applied" — and it fails silently. It is plural.

## B2. Middleware matching and order

- `defineMiddlewares({ routes: [{ matcher, method, middlewares }] })` from
  `@medusajs/framework/http`.
- `matcher` is a path-to-regexp string (`"/custom*"`) or a `RegExp`. **Always
  anchor a RegExp with `^\/`.**
- `method` is optional. **Omitted, the middleware applies to EVERY HTTP method
  on that route** — including the `GET` you did not mean to guard. Name the
  method unless you truly mean all of them.
- ⚠️ **A trailing-slash mismatch skips the middleware.** A matcher not ending in
  a slash is not applied to a request for `/custom/`.
- Execution order: global middlewares (core → plugins → app), then route
  middlewares (core → plugins → app), then the handler. Within a group:
  wildcard → regex → static → static-with-params.
- 🔴 **A middleware cannot override an existing one — it is appended to the
  stack.** You cannot "replace" an inherited middleware by redeclaring it.

## B3. The workflow constructor is a DEFINITION, not code that runs

This is the single most misunderstood part of the framework, and the cause of
workflows that appear to work and quietly do nothing.

> "Variables in the workflow don't have any values. They only do when you
> execute the workflow."

The function you pass to `createWorkflow` runs **once, at definition time**, to
build a graph. So inside it you must NOT:

- ❌ read or mutate a step's returned value (`if (result.ok)`, `result.x = 1`)
- ❌ use `if` / `else` on workflow data
- ❌ loop (`for`, `.map`) over workflow data
- ❌ `await` anything

Instead:

- **`transform(deps, fn)`** to derive a new value from workflow variables.
- **`when(...).then(...)`** for conditional execution.
- Do all ordinary imperative work **inside a step**, where values are real.

⚠️ **`transform` is lazy.** Its function only runs if the result is passed to a
step or returned in `WorkflowResponse`. A `transform` whose value is unused
never executes — including any side effect or validation you put in it. Never
validate inside a `transform`; use a step or `when-then`.

## B4. Steps and compensation

- `createStep(name, invoke, compensate)`; kebab-case name, unique.
- A step's invoke **must return `new StepResponse(data)`**. Returning a bare
  object returns nothing to the workflow.
- The workflow function **must return `new WorkflowResponse(...)`**.
- A step receives `(input, { container })` — resolve services from `container`,
  never import them.
- **Compensation input is the SECOND argument to `StepResponse`**, not the
  first:
  ```ts
  return new StepResponse(result, { id_to_roll_back: created.id })
  ```
  The compensation function receives that second value as its first parameter.
  🔴 If you only pass one argument, your compensation function gets `undefined`
  and cannot undo anything — a rollback that runs and silently does nothing.
- Compensation runs **only when a later step throws**, never on success.
- 🔴 **For a step with a loop that can fail part-way, return
  `StepResponse.permanentFailure()` from the catch** so compensation still
  receives the partial progress. Otherwise the items already created leak.
- Invoke a workflow with `myWorkflow(container).run({ input })`. From a route
  the container is `req.scope`; from a subscriber or job it is `container`.

## B5. Modules are isolated

- `src/modules/<name>/` with `models/`, `service.ts` (extends `MedusaService`),
  `index.ts` exporting `Module(NAME, { service })`.
- The module name may contain **only alphanumerics and underscores**.
- A new module must be registered in `medusa-config.ts` under `modules`:
  `{ resolve: "./src/modules/blog" }`. **An unregistered module does not
  exist** — `container.resolve(NAME)` throws at runtime, not at build.
  ⚠️ This repo has **three** config files — `medusa-config.ts`,
  `medusa-config.dev.ts` and `medusa-config.prod.ts`. Registering in one
  and not the other ships a module that works locally and 500s in production.
- A module service reaches its OWN models only. To join across modules use a
  module link and `query.graph` — see Part A §4.
