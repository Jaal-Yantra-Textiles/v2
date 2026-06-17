# Visual Flows — Module Analysis & Plugin Roadmap (#459)

_Analysis date: 2026-06-17. Module: `apps/backend/src/modules/visual_flows` (+ admin UI, API, workflows, subscribers, jobs)._

This note answers the five questions in issue #459:

1. Can we release this as a Medusa plugin?
2. What can be improved in the execution engine?
3. How do we run isolated code safely?
4. How do we handle heavy code / data crunching?
5. Caching + queue (Redis / workflow-style) like Medusa does it.

---

## 0. What the module actually is today

A visual, node-based automation builder (think n8n / Directus Flows) embedded in
the Medusa admin. Users drag operation nodes onto an [`@xyflow/react`] canvas,
wire them up, and the graph runs against the Medusa container.

**Footprint (all under `apps/backend/src`):**

| Layer | Location | ~LOC |
|---|---|---|
| Module (models, service, operations, engine) | `modules/visual_flows/` | ~7,300 |
| Admin UI (canvas, panels, code/json editors) | `admin/components/visual-flows/` | ~5,300 |
| API routes | `api/admin/visual-flows/`, `api/webhooks/flows/` | ~2,400 |
| Workflows | `workflows/visual-flows/` | ~1,270 |
| Subscribers | `subscribers/visual-flow-*.ts` | — |
| Scheduled job | `jobs/run-scheduled-visual-flows.ts` | — |

**Data model** (`modules/visual_flows/models/`): `visual_flow`,
`visual_flow_operation`, `visual_flow_connection`, `visual_flow_execution`,
`visual_flow_execution_log`.

**Triggers** (all converge on the same `executeVisualFlowWorkflow`):
- **Manual** — `POST /admin/visual-flows/:id/execute` (awaits, returns result).
- **Event** — `subscribers/visual-flow-event-trigger.ts` subscribes to ~60 events; matches `event_pattern`/`event_types`/`event_type`; runs inline in the subscriber.
- **Schedule** — `jobs/run-scheduled-visual-flows.ts` runs every minute (`* * * * *`), parses each flow's cron in JS, dedups per-minute via `metadata.schedule.last_run_minute_key`.
- **Webhook** — `POST /webhooks/flows/:id`; sync by default, fire-and-forget if `trigger_config.async`.

**~25 operations** registered in `operations/index.ts`: data CRUD (`read/create/update/delete_data`), bulk variants, `condition`, `transform`, `http_request`, `bulk_http_request`, `trigger_workflow`, `trigger_flow`, `execute_code`, `send_email`, `send_whatsapp`, `notification`, AI extract, analytics (`aggregate_data`, `time_series`, `aggregate_product_analytics`, `cart_recovery_stats`), `generate_partner_deeplink`, `sleep`, `log`.

---

## 1. Biggest structural finding: two execution paths, one is dead

There are **two** copies of the graph-execution logic:

- `modules/visual_flows/execution-engine.ts` — `FlowExecutionEngine` class.
  **Dead code.** `grep` for `FlowExecutionEngine` / `createExecutionEngine` /
  `execution-engine` across the whole backend returns _zero_ references outside
  the file itself.
- `workflows/visual-flows/execute-visual-flow.ts` — `executeOperationsStep` +
  `executeOperationsRecursive`. **This is the live path.** Every trigger calls
  `executeVisualFlowWorkflow`.

The two implementations have drifted (e.g. the engine reads operations from the
DB rows; the workflow reads from `canvas_state.nodes` with a DB fallback). Bugs
get fixed in one and not the other.

> **Action (cheap, do first):** delete `execution-engine.ts`, or — better —
> invert it: make the workflow step a thin wrapper that calls a single
> `FlowExecutionEngine.run()`. One graph executor, period. This is also the
> precondition for everything below (plugin extraction, isolation, queueing all
> need _one_ engine to modify).

---

## 2. Execution-engine improvements (#2)

Today the entire operation graph runs inside **one** workflow step
(`executeOperationsStep`) as a synchronous in-process recursion. Consequences:

| Issue | Detail | Impact |
|---|---|---|
| **No per-operation durability** | The workflow is `store:true` and prod has `workflow-engine-redis`, so the _flow_ is a durable workflow — but the whole graph is one step. A crash mid-graph re-runs the **entire** flow, not from the failed node. | No resume; re-sends emails, re-writes data. |
| **No retry/backoff per op** | First failing op throws and aborts the flow. No `http_request` retry, no transient-error handling. | Flaky HTTP / rate limits kill whole flows. |
| **Sequential only** | `executeOperationsRecursive` walks connections depth-first, `await` each. Two independent branches can't run in parallel. | Slow flows; bulk ops serialize. |
| **No concurrency/loop primitives** | No native "for-each item → sub-graph", no map/fan-out node. `bulk_*` ops hand-roll loops internally. | Each bulk op reinvents batching; inconsistent. |
| **Flow def re-loaded every run** | `getFlowWithDetails` hits Postgres on every execution; no cache despite Redis being available. | DB load on high-frequency event flows. |
| **Graph re-derived every run** | Canvas→operations→connections mapping + topo-root synthesis runs at execution time. | CPU per execution; should be compiled once on save. |
| **Recursion can double-execute** | `executeOperationsRecursive` re-visits nodes reachable by multiple paths (no visited-set on the executed node, only branch filtering). Diamond graphs can run a node twice. | Correctness risk — verify. |
| **Cancellation is weak** | `visual_flow_execution.cancelled` is emitted on compensation, but a running in-process recursion can't be interrupted. | "Cancel" doesn't stop a running flow. |

**Recommended engine model — compile then execute:**

1. **Compile on save** (in `update-visual-flow`): validate the graph, detect
   cycles, topologically sort, resolve each node's operation handler + options
   schema, and persist a normalized "compiled plan" (nodes + adjacency +
   entrypoints). Execution stops re-deriving the graph from `canvas_state`.
2. **Execute as a real workflow** where _each operation is its own durable step_
   (or batched levels of the topo-sort are parallel steps). This gives
   per-op retry, resume-from-failure, and parallel branches for free from
   `workflow-engine-redis`. This is the single highest-leverage change.
3. **Per-op policy**: `retries`, `timeout`, `continue_on_error`, declared on the
   operation definition + overridable per node.
4. **Parallel branches**: execute each topo "level" with `Promise.all` (or
   parallel workflow steps); only join where the graph joins.

---

## 3. Running isolated code (#3) — current state is unsafe

`operations/execute-code.ts` + `operations/package-loader.ts`. Two serious
problems:

### 3a. The "sandbox" is not a sandbox
`runInSandbox` uses `new Function(...paramNames, code)` (line ~581). The file's
own comment admits: _"This is not a true sandbox."_ It is trivially escapable —
`this.constructor.constructor("return process")()` reaches the real `process`,
`globalThis`, `require`, the filesystem, env vars, the DB connection, etc. The
`BLOCKED_PACKAGES` denylist only blocks _named requires_; it does nothing about
prototype-chain escapes. The `timeout` is a cooperative `Promise.race` — it
**cannot interrupt** a CPU-bound `while(true){}`; the loop pins the event loop
and the timer never fires.

### 3b. Runtime `npm install` in the server process
`package-loader.ts` does `execSync('npm install <pkg> --legacy-peer-deps')` into
`process.cwd()/.cache/visual-flow-packages` on first use, then `eval('require')`
loads it. In a production container this is:
- **Arbitrary code execution** — installing an arbitrary npm package runs its
  postinstall scripts as the server user, and loads attacker-controlled code
  into the main process.
- **Non-reproducible & fragile** — writes to an ephemeral container FS, needs
  network egress to the npm registry, 60s blocking `execSync` on the request
  path, and breaks on read-only / multi-replica filesystems.

> This is the **#1 risk in the whole module.** It should be gated behind an env
> flag and disabled in prod _now_, independent of the bigger rework.

### Recommended isolation strategy (tiered)

| Tier | Mechanism | Use |
|---|---|---|
| **Now (stop-gap)** | Hard-disable runtime `npm install` in prod (env flag); pre-bundle the allowlisted libs (`lodash`, `dayjs`, `validator`, `crypto`, `fetch`) that already ship; keep `new Function` only for trusted-admin flows. | Removes RCE-by-install today. |
| **Real isolation (in-process)** | [`isolated-vm`] — true V8 isolates with a hard memory cap and a real wall-clock/CPU timeout that _interrupts_ execution. No access to host globals unless explicitly injected. | Untrusted/multi-tenant code in the same process. |
| **Strong isolation (out-of-process)** | Vercel Sandbox / Firecracker microVM / a dedicated worker container per execution. Best for "heavy crunching" (see #4) and true multi-tenant SaaS. | SaaS Dedicated tier; long/heavy jobs. |

For the multi-tenant SaaS direction (`project_medusa_saas_vision`),
**`isolated-vm` is the pragmatic next step**; out-of-process sandboxing is the
Dedicated-tier answer. Either way, package access becomes a **curated, pre-built
allowlist** baked into the image — never runtime-installed.

---

## 4. Heavy code & data crunching (#4)

Everything runs in the API/worker process, in memory, on the event loop:
- `read_data` / `aggregate_data` load whole result sets into JS arrays — no
  streaming, no pagination ceiling, no backpressure. A large `read_data` OOMs
  the worker.
- `bulk_*` operations loop in-process and serialize; one slow item blocks the rest.
- A long flow occupies a workflow worker slot for its entire duration; prod runs
  split server/worker (`MEDUSA_WORKER_MODE`), so heavy flows starve other jobs.

**Recommendations:**
1. **Offload heavy ops to background jobs / a queue** (see #5) rather than
   running them inline in the trigger request.
2. **Stream + paginate** `read_data`/aggregations; cap result size with an
   explicit, surfaced limit (`feedback_use_skeletons_everywhere` cousin: never
   silently truncate — log/return what was dropped).
3. **Batch + bounded concurrency** for `bulk_*` (e.g. p-limit), and ideally
   model them as fan-out workflow steps rather than internal loops.
4. **Push CPU-bound `execute_code` off the main loop** — `isolated-vm` with a
   memory cap, or out-of-process workers for genuinely heavy crunching.
5. **Aggregations belong in SQL/the DB**, not in JS, wherever the entity model
   allows `query.graph` + DB-side grouping.

---

## 5. Caching + queue, the Medusa way (#5)

The infra is **already provisioned** in `medusa-config.prod.ts`:
`@medusajs/medusa/caching` (caching-redis, default), `event-bus-redis`,
`workflow-engine-redis`, and `locking-redis` — all on the same ElastiCache
Serverless (Valkey) cluster. The flow module uses **none** of the cache/queue
capabilities directly.

**Caching:**
- Cache the **compiled flow plan** (see #2.1) in Redis keyed by
  `flow_id:updated_at`; invalidate on save. Removes the per-execution DB load +
  graph re-derivation.
- Cache the operations/metadata catalog responses
  (`/admin/visual-flows/operations`, `/metadata`).

**Queue / async execution (the real win):**
- Medusa's idiomatic queue _is_ the **workflow engine** (`workflow-engine-redis`)
  — it already gives durable, retryable, distributed step execution. Lean into
  it (per-op steps, #2.2) instead of running the whole graph inline.
- For triggers that shouldn't block (events, webhooks, schedules): **enqueue**
  the execution (return `202`/ack immediately) and let a worker run it. Today
  the event subscriber and the every-minute schedule job both run flows _inline_
  — move them to enqueue-and-ack.
- The `* * * * *` schedule scanner that loads all schedule-flows and parses cron
  in JS every minute should become either real per-flow scheduled jobs or a
  durable-timer/queue-delay mechanism.

---

## 6. Releasing as a Medusa plugin (#1)

**Feasible, but it's a refactor, not a `mv`.** The module proper
(`modules/visual_flows`) is reasonably self-contained, but the _feature_ is
spread across `admin/`, `api/`, `workflows/`, `subscribers/`, `jobs/`, and the
operations have **JYT-specific couplings** that a generic plugin can't ship:

- `generate-partner-deeplink.ts`, `cart-recovery-stats.ts`,
  `aggregate-product-analytics.ts`, `ai-extract-platform.ts`,
  `send-whatsapp.ts` — all reference JYT modules / business concepts.
- The event-trigger subscriber hard-codes ~60 JYT/Medusa event names.
- `$env` allow-list and credentials are app-specific.

**Recommended shape — split into core + extensions:**

```
@jyt/visual-flows          ← plugin: engine, models, base operations,
                              admin UI, API routes, generic triggers
                              (data CRUD, condition, transform, http,
                               trigger_workflow, execute_code, log, sleep,
                               send_email, notification)
apps/backend (host)        ← registers JYT-specific operations via a public
                              `registerOperation()` extension point:
                              partner-deeplink, cart-recovery, whatsapp,
                              product-analytics, ai-extract-platform
```

Prerequisites before extraction (do these first regardless of the plugin):
1. **Collapse to one engine** (#1 above) — can't ship two.
2. **Make the operation registry an open extension point** so host apps add ops
   without editing `operations/index.ts`.
3. **Decouple the trigger event list** from hard-coded names (config-driven
   subscription).
4. **Parameterize `$env` allow-list / secrets** via plugin options.
5. **Settle the isolation story** (#3) — a plugin that ships runtime `npm install`
   + `new Function` is not something we'd publish.

Package using Medusa 2.x plugin conventions (exports map for `modules`,
`workflows`, `subscribers`, `jobs`, `admin` extensions). Good external precedent
exists (Directus Flows, n8n) for the UX, but the Medusa-plugin packaging is the
new work.

---

## 7. Recommended sequencing

Each step is independently shippable and de-risks the next.

| # | Step | Why first |
|---|---|---|
| **P0** | Disable runtime `npm install` in prod (env flag); pre-bundle allowlisted libs. | Closes the live RCE-by-install surface immediately. |
| **P0** | Delete/converge the dead `execution-engine.ts` → single executor. | Precondition for all engine work; stops drift. |
| **P1** | Compile-on-save plan + Redis cache of the compiled plan. | Removes per-run DB load + graph re-derivation; foundation for durable steps. |
| **P1** | Per-operation durable workflow steps (retry, resume, `continue_on_error`). | The core execution-engine upgrade; uses infra we already pay for. |
| **P2** | Real code isolation (`isolated-vm`, hard mem/CPU limits, curated packages). | Makes `execute_code` safe for untrusted/multi-tenant use. |
| **P2** | Enqueue-and-ack for event/webhook/schedule triggers; parallel branches; streaming/bounded bulk ops. | Heavy-crunch + throughput; stops inline blocking. |
| **P3** | Extract to `@jyt/visual-flows` plugin with an open operation-registry extension point; JYT ops stay in the host app. | Reuse / SaaS packaging, once the engine is clean and safe. |

---

## 8. Key file references

- Live executor: `apps/backend/src/workflows/visual-flows/execute-visual-flow.ts` (`executeOperationsStep`, `executeOperationsRecursive`)
- Dead executor: `apps/backend/src/modules/visual_flows/execution-engine.ts`
- Code sandbox: `apps/backend/src/modules/visual_flows/operations/execute-code.ts` (`runInSandbox`, `new Function`)
- Runtime npm install: `apps/backend/src/modules/visual_flows/operations/package-loader.ts` (`installPackage`, `execSync`)
- Operation registry / types: `apps/backend/src/modules/visual_flows/operations/types.ts`, `operations/index.ts`
- Triggers: `subscribers/visual-flow-event-trigger.ts`, `jobs/run-scheduled-visual-flows.ts`, `api/webhooks/flows/[id]/route.ts`
- Infra (Redis cache/event-bus/workflow-engine/locking): `apps/backend/medusa-config.prod.ts` lines ~108–168
- Admin UI: `apps/backend/src/admin/components/visual-flows/` (`flow-editor.tsx`, `panels/properties-panel.tsx`)

[`@xyflow/react`]: https://reactflow.dev
[`isolated-vm`]: https://github.com/laverdet/isolated-vm
