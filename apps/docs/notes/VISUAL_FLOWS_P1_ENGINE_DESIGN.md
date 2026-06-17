# Visual Flows — P1 Engine Rework Design (#459)

_Design date: 2026-06-17. Builds on `VISUAL_FLOWS_PLUGIN_ANALYSIS.md`._
_Scope: P1 only — compile-on-save plan, Redis plan cache, per-operation durability
(retry / resume / parallel), and durable waits via long-running workflows._

---

## 0. The one hard constraint that shapes everything

Confirmed against the Medusa 2.x docs (workflows-sdk):

> **The `createWorkflow` composition function runs once at application load time
> and builds a _static_ DAG.** Variables inside it are graph-node proxies, not
> runtime values. You cannot `if/else` on runtime data (use `when()`), cannot
> read a step's output (use `transform()`), and **cannot iterate a
> runtime-length list to emit N steps.**

Therefore the obvious idea — "compile each user node into its own native
workflow step" — **is not expressible.** A flow's node count, shape, and
branching are runtime data. We must execute a dynamic graph *inside* steps while
still getting durability from the workflow engine. The rest of this design is how.

Primitives we _do_ get (all confirmed, prod already runs `workflow-engine-redis`):

| Primitive | API | What it buys us |
|---|---|---|
| Step retry | `createStep({ name, maxRetries, retryInterval, autoRetry, timeout }, …)` | Per-step retry w/ backoff. **The whole step fn re-runs** (atomic unit — no mid-step resume). |
| Nested workflow | `child.runAsStep({ input })` in composition | Compose a static child workflow; participates in parent compensation. |
| Long-running / async step | step returns **no** `StepResponse`; later `workflowEngine.setStepSuccess/Failure({ idempotencyKey:{ action, transactionId, stepId, workflowId }, stepResponse })` | **Suspend durably in Redis** with no process held; resume on external signal. Also `retryInterval` makes a workflow long-running. |
| Redis durability | `@medusajs/medusa/workflow-engine-redis` | Completed steps persisted & not re-run after crash; in-flight step may need a manual `retryStep()`. |

---

## 1. Compile-on-save (deterministic plan, built once)

Today the graph is re-derived from `canvas_state` on **every** execution
(`executeOperationsStep`, ~lines 271–353): node→op mapping, edge→connection
mapping, topo-root synthesis. Move all of that to **save time**, inside
`update-visual-flow` / `create-visual-flow`.

**Add a compile step** that produces a normalized, validated `CompiledPlan`:

```ts
type CompiledPlan = {
  version: 1
  entrypoints: string[]                 // node ids reachable from $trigger
  levels: string[][]                    // topological levels (each level = parallelizable)
  nodes: Record<string, CompiledNode>   // by node id
  hash: string                          // content hash for cache keying
}
type CompiledNode = {
  id: string
  key: string                           // operation_key (data-chain slot)
  type: string                          // operation_type → registry handler
  options: Record<string, any>
  next: { default: string[]; success: string[]; failure: string[] }
  policy: { maxRetries: number; retryInterval?: number; timeoutMs?: number; continueOnError: boolean }
}
```

Compilation does the work that must **fail loud at save, not at 3am**:
1. Resolve every `operation_type` against `operationRegistry` → unknown type = save error.
2. Validate each node's `options` against the op's `optionsSchema` (Zod).
3. **Cycle detection** + topological sort into `levels` (Kahn's algorithm); a
   cycle = save error (today an accidental cycle would infinite-loop the executor).
4. Resolve branch handles (`success`/`failure`/`default`) into `next`.
5. Compute `hash` over the normalized plan.

**Persistence:** add a `compiled_plan` (jsonb) + `compiled_hash` column to
`visual_flow` (hand-written `ADD COLUMN IF NOT EXISTS` migration — see
`reference_medusa_migration_create_if_not_exists_hazard`). Keep `canvas_state`
as the editor's source of truth; `compiled_plan` is the execution artifact.

**Cache:** store the compiled plan in Redis (caching module already configured),
key `vflow:plan:{flowId}:{compiled_hash}`, invalidated implicitly by the hash
changing on save. Execution reads cache → falls back to column → (last resort)
recompiles. Removes the per-execution Postgres load + graph re-derivation.

---

## 2. Durable execution model

Two layers: a **driver** (resumable) and a **per-op unit** (durable + retried).

### 2a. Per-operation unit = a generic nested workflow

One static, generic workflow — `runFlowOperationWorkflow` — that executes
exactly one node:

```ts
// input: { executionId, flowId, nodeId } ; reads node + dataChain from the execution row
const runOperationStep = createStep(
  { name: "run-flow-operation", maxRetries: 3, retryInterval: 5, timeout: 30 },
  async ({ executionId, flowId, nodeId }, { container }) => {
    // load compiled node + current dataChain (checkpointed), resolve handler,
    // interpolate options, execute handler.execute(opts, ctx), append log row,
    // persist dataChain[node.key] + $last back to the execution row (checkpoint)
    return new StepResponse({ outputKey: node.key })
  }
)
export const runFlowOperationWorkflow = createWorkflow("run-flow-operation", (input) => {
  return new WorkflowResponse(runOperationStep(input))
})
```

- **Per-op retry/backoff/timeout** come free from the step config; `policy` from
  the compiled node overrides defaults (mapped at the driver, since config is
  static we pick sensible global defaults + honor `continueOnError` in the driver).
- The op handler signature is unchanged (`execute(options, context) → OperationResult`),
  so all ~25 existing operations keep working.

### 2b. Driver = resumable orchestrator step

The parent `execute-visual-flow` workflow's heavy step becomes a **resumable
driver** that walks `compiled_plan.levels` and, for each ready node, invokes the
per-op unit. Crucially it **checkpoints to the execution row after every node**,
so on a step retry (the whole step re-runs — that's the Medusa rule) it **skips
already-completed nodes** and continues:

```
driver(executionId):
  plan = loadCompiledPlan(flowId)              # Redis → column
  state = loadExecutionState(executionId)      # completed set + dataChain (resume)
  for level in plan.levels:
    ready = [n in level if n not in state.completed and deps satisfied & branch-active]
    results = await mapWithConcurrency(ready, CONCURRENCY, n =>
                 runFlowOperationWorkflow(container).run({ input:{executionId, flowId, nodeId:n} }))
    for each result:
      if failed and not node.policy.continueOnError: throw   # aborts → step retry resumes here
      state.completed.add(n); persist(state)                 # checkpoint
    pruneInactiveBranches(condition results)                 # success/failure handles
```

Why this shape:
- **Each op is its own durable, retried workflow run** (Redis-backed).
- **Parallel branches**: nodes in the same topo level run concurrently with a
  bounded `CONCURRENCY` (fixes today's strictly-sequential recursion).
- **Resume-from-failure**: the driver step is idempotent via the checkpointed
  `completed` set + `dataChain` — re-running the step doesn't re-send emails or
  re-write data for completed nodes.
- **Correctness fix**: level-based execution + a `completed` set removes today's
  diamond-graph double-execution risk in `executeOperationsRecursive`.

> Trade-off vs the "ideal": the driver is still one step, so a *driver* crash
> mid-level requires the step to re-run (cheap — it skips completed nodes). We do
> **not** get the workflow engine scheduling each op as an independent graph node
> (impossible under the static-composition constraint), but we get the
> properties that matter: per-op retry, resume, parallelism, durability.

### 2c. The fully-distributed variant (defer to P2/SaaS)

If we later need true per-op distribution / fan-out across workers, switch the
driver from an in-step loop to **event-driven progression**: each op-complete
emits `visual_flow.node_completed`; a subscriber computes newly-ready nodes and
runs their per-op workflows. Same per-op unit, no long-lived driver process.
More moving parts — only worth it at SaaS scale. Documented, not built in P1.

---

## 3. Durable waits — long-running workflows (the part #459 was reaching for)

Today `sleep` uses `setTimeout(min(ms, 5000))` — capped at 5s and **lost on
restart**. Real automation needs "wait 3 days, then send", "pause for human
approval", "wait for this webhook". These are exactly **long-running workflows**.

Model a *waiting* node as an **async step** in the per-op unit (it returns no
`StepResponse`), so the workflow **suspends in Redis holding no process**:

- `wait_for_duration` (replaces `sleep`): schedule a resume via `retryInterval`
  / a scheduled job that calls `setStepSuccess` when the deadline passes.
- `wait_for_event` / `wait_for_webhook`: the inbound event/webhook handler calls
  `workflowEngine.setStepSuccess({ idempotencyKey:{ action: INVOKE, transactionId,
  stepId, workflowId }, stepResponse })` to resume the exact suspended execution.
- `human_approval`: an admin action resolves the step (`setStepSuccess` /
  `setStepFailure`).

This requires the per-op unit to expose its `transactionId` (returned from
`.run()`), persisted on the `visual_flow_execution` row so external signals can
find and resume the right suspended step. Long waits no longer pin a worker and
survive restarts.

---

## 4. Triggers: enqueue-and-ack

Independent of the engine internals, stop running flows inline on the request
path:
- **Event subscriber** & **webhook** (`trigger_config.async`) & **schedule job**:
  return `202`/ack immediately and let the durable workflow run in the worker
  (prod already splits server/worker via `MEDUSA_WORKER_MODE`).
- The every-minute `* * * * *` schedule scanner stays, but only *enqueues* due
  flows; it must never execute them inline (today it `await`s each).

---

## 5. Migration & safety

- **Backwards compatible:** keep reading `canvas_state`; `compiled_plan` is
  additive. Old flows without a compiled plan compile lazily on first run + on
  next save (backfill job optional).
- **Kill the dead engine** (`execution-engine.ts`) as part of this — there must
  be exactly one executor (the driver), so the legacy class doesn't re-drift.
- **Feature-flag** the new executor (`VFLOW_DURABLE_EXECUTOR`) so we can roll
  back to the current single-step path if needed; run both against the test
  suite (`operations/__tests__`, integration flows) before flipping prod.
- Migration column adds via hand-written `ADD COLUMN IF NOT EXISTS`
  (`reference_medusa_migration_create_if_not_exists_hazard`).

---

## 6. Build order (each shippable)

| # | Slice | Outcome |
|---|---|---|
| 1 | Compile step + `compiled_plan`/`compiled_hash` columns + validation/cycle-detect on save | Save-time failures; deterministic plan. No exec change yet. |
| 2 | Redis plan cache + execution reads plan (not canvas) | Removes per-run DB load + graph re-derivation. |
| 3 | `runFlowOperationWorkflow` per-op unit + resumable checkpointing driver (behind flag) | Per-op retry + resume + parallel levels; delete dead engine. |
| 4 | Long-running wait nodes (`wait_for_duration`/`wait_for_event`/`human_approval`) | Durable waits; real delays. |
| 5 | Enqueue-and-ack triggers (event/webhook/schedule) | No inline blocking. |

P2 (separate): event-driven distributed driver (2c), `isolated-vm`, streaming/
bulk — per the analysis note.

---

## 7. Open questions

- **Per-op retry config is static** (`createStep` config is fixed at load). The
  per-node `policy.maxRetries/retryInterval` can't directly parameterize the
  step config. Resolution: pick conservative global step defaults and implement
  per-node overrides as an **application-level retry loop inside the per-op
  step** (bounded), reserving the engine's retry for infra-level failures. Verify
  this composes cleanly with `continueOnError`.
- **`setStepSuccess` addressing**: confirm the `transactionId` + `stepId`
  for a nested per-op workflow is stable & retrievable for the resume signal.
- **Compensation semantics**: visual-flow ops are mostly external side-effects
  (emails, HTTP) with no real rollback. Decide explicitly that flow ops are
  *forward-only* (no compensation) and rely on retry/`continueOnError` + the
  failure lifecycle event, rather than pretending compensation works.
