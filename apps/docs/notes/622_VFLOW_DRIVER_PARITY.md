# #622 — Visual-Flow Driver Feature-Parity Checklist + Shadow-Run Plan

_Authored 2026-06-24. This is the **gate** before the live executor is rewritten
onto the #463 compile-on-save path (#459 build-order slice 3 — the resumable
`runFlowOperationWorkflow` per-op unit + checkpointing driver)._

> **DO NOT cut over to the compiled-plan driver until EVERY box below is checked
> AND the shadow-run (§4) is clean.** Each box encodes a hard-won fix that the
> current single-step executor already ships. The rewrite must not silently
> regress any of them. Checklist + plan only — this PR does **not** touch the
> driver.

## 0. What we are comparing

| | Live driver (today) | Compiled-plan driver (target) |
|---|---|---|
| Source of truth at exec | `flow.canvas_state` re-derived every run | `flow.compiled_plan` (Redis cache → column → recompile) |
| Graph build | inline in `executeOperationsStep` | `compileFlow()` at save (`compiler.ts`) |
| Traversal | `executeOperationsRecursive` (DFS + `visited` set) | `compiled_plan.levels` walk + `completed` checkpoint set |
| Durability | one step; whole step re-runs on retry | per-op nested workflow + checkpoint resume |

**Authoritative source files (read before checking any box):**
- Live driver: `apps/backend/src/workflows/visual-flows/execute-visual-flow.ts`
- Operation executors: `apps/backend/src/modules/visual_flows/operations/*.ts`
- Registry + types: `…/operations/types.ts`, registration in `…/operations/index.ts`
- Interpolation: `…/operations/utils.ts` (`interpolateVariables` / `interpolateString` / `getValueByPath`)
- Compiler (#463): `apps/backend/src/modules/visual_flows/compiler.ts`
- Plan cache: `…/flow-plan-cache.ts`; compile-on-save: `…/visual-flow-steps.ts` (`compileFlowPlanStep`), service `compileAndPersistPlan`
- Durable wait primitive: `…/workflows/visual-flows/flow-wait.ts`; resume route `…/api/admin/visual-flows/waits/[transaction_id]/resume/route.ts`

Each box names the **exact symbol/line** that implements today's behavior and
the **test/observation** that proves the compiled path matches.

---

## 1. Graph construction & traversal parity

The live driver derives the runnable graph inside `executeOperationsStep`
(`execute-visual-flow.ts:257-378`). `compiler.ts:extractGraph` claims to mirror
this, but every divergence below is a silent behavior change.

- [ ] **Canvas-first, DB-fallback node source.** Live: `dbOpByKey` built from
  `flow.operations`, then canvas nodes mapped; **canvas node options take
  precedence**, DB op options fill the gap (`execute-visual-flow.ts:280-317`,
  `hasCanvasOptions` check). Compiler mirrors this in `extractGraph`
  (`compiler.ts:73-94`) — but uses `canvasNodes.some(n => n.id !== "trigger")`
  to decide "usingCanvas", whereas the live driver **always** reads canvas nodes
  and only falls back per-key. **Verify:** a flow whose `canvas_state` has nodes
  but a node's options live only in the DB op row compiles with those DB options;
  a seed-only flow (DB ops, empty canvas) compiles from DB. _Test:_ unit fixture
  for both shapes asserting `compiledNode.options` equals the live driver's
  `resolvedOptions`.

- [ ] **`operation_key` resolution.** Live: `opKey = nodeData.operationKey || node.id`
  (`:294`). Compiler: `key = data.operationKey || node.id` (`:79`). **Verify:**
  node without `operationKey` falls back to canvas node id in BOTH; the data-chain
  slot written (`dataChain[operation_key]`) is identical.

- [ ] **`operation_type` resolution + `"unknown"` default.** Live: `nodeData.operationType
  || dbOp?.operation_type || "unknown"` (`:310`). Compiler: same (`:84`). **Verify:**
  unknown type → live throws at run (`executeSingleOperation:521-523`), compiler
  records a **hard error** (`compiler.ts:156-158`) blocking activation. Confirm
  the compiled driver also refuses to run an unknown-type node (no silent skip).

- [ ] **Implicit trigger→root synthesis.** Live: when no edge has
  `source_id === "trigger"`, every node with no incoming edge becomes an
  entrypoint (`execute-visual-flow.ts:336-350`). Compiler: identical fallback —
  `entrypoints = triggerTargets` else zero-indegree nodes
  (`compiler.ts:208-213`). **Verify:** a seed flow with no explicit trigger edge
  has the same starting-op set under both. _Test:_ unit fixture comparing live
  `startingOps` ids vs `compiled_plan.entrypoints`.

- [ ] **Branch-handle edge classification.** Live `connection_type`: `success`/
  `failure` if `sourceHandle` is one of those, else `default`
  (`execute-visual-flow.ts:326-331`). Compiler buckets into
  `next.{default,success,failure}` the same way (`compiler.ts:200-206`).
  **Verify:** condition node with `success`/`failure`/`default` handles routes to
  identical targets.

- [ ] **Position-ordered execution within a frontier.** Live sorts ready ops by
  `position_y` then `position_x` (`executeOperationsRecursive:451-454`). Side
  effects (emails, writes) thus fire top-to-bottom, left-to-right. The compiled
  `levels` are topological, **not position-ordered** — within a level the driver
  MUST re-impose the same `(position_y, position_x)` ordering (or document why
  ordering is irrelevant). **Verify:** a flow with two sibling send-email nodes
  at different y-positions emits in the same order under both. _Watch-out:_ this
  is the easiest silent regression — `compiledNode` does **not** currently carry
  `position_x/position_y`; the rewrite must add them or order is lost.

---

## 2. The #468 visited-set dedup guard (diamond / cycle safety)

`executeOperationsRecursive` keeps a `visited: Set<string>` keyed by canvas node
id; a node already in the set is skipped (`execute-visual-flow.ts:447-464`,
:459-463). This fixed two real bugs (doc comment :420-435).

- [ ] **Diamond-join no double-exec.** A→B→D, A→C→D runs D **once**. In the
  compiled driver this is the `completed` set + level-based walk. **Verify:**
  _unit test_ mirroring the existing recursion test: a diamond graph executes the
  join node exactly once (assert `execOp` called once for D / one success log row
  for D). The live test lives in `…/workflows/visual-flows/__tests__/` — port it
  to the compiled driver, do not replace it.

- [ ] **Cycle no infinite-loop.** An accidental A→B→A does not hang the worker.
  Compiled path defends EARLIER: `compileFlow` rejects cycles at save
  (`compiler.ts:242-246`, Kahn leftover ⇒ error), so an active flow can never
  contain one. **Verify:** (a) saving a cyclic graph as `active` throws
  (`service.compileAndPersistPlan` with `block:true` → `MedusaError`,
  `service.ts:45-50`); (b) the runtime driver still has a belt-and-suspenders
  `completed`/visited guard so a hand-mutated/legacy plan can't loop.

- [ ] **Join semantics are NOT upgraded silently.** Today D runs on the FIRST
  branch to reach it (not after ALL parents) — see the explicit caveat at
  `execute-visual-flow.ts:429-432`. The compiled driver's level-walk naturally
  waits for all parents in a level. This is a **behavior change** (true fan-in
  join). **Decision required before cutover:** is that acceptable for every
  production flow, or must the driver replicate first-reach semantics for
  parity? Document the chosen semantics; do not let it change by accident.

---

## 3. Per-operation execution + logging parity

`executeSingleOperation` (`execute-visual-flow.ts:511-618`) is the contract every
operation relies on. The compiled per-op unit (`runFlowOperationWorkflow`) MUST
reproduce all of it.

- [ ] **Handler lookup.** `operationRegistry.get(operation_type)`; missing → throw
  `Unknown operation type` (`:519-523`). Compiled unit uses the SAME global
  registry (auto-registered in `operations/index.ts:71-116`). **Verify:** all 30
  registered ops resolve (enumerated in §6).

- [ ] **`OperationContext` shape.** `{ container, dataChain, flowId, executionId,
  operationId, operationKey }` (`:526-533`, type at `operations/types.ts:27-34`).
  Compiled unit must pass an identical context (notably `operationId` =
  graph/canvas node id, `operationKey` = data-chain slot). **Verify:** an op that
  reads `context.operationKey` / `context.executionId` (e.g. logging ops) behaves
  identically.

- [ ] **Raw options to handler, interpolated options to log.** Live passes
  **raw** `operation.options` to `handler.execute` so each op does its own
  per-item interpolation (`:539-560`, comment :535-538); the log row stores
  `interpolateVariables(rawOptions, dataChain)` (`resolvedOptionsForLog`).
  **This is load-bearing** (see §5 — double-interpolation kills `{{ item.name }}`
  loops). **Verify:** _unit test_ that the compiled unit calls `execute` with raw
  options and writes interpolated `input_data` — never the reverse.

- [ ] **Data-chain mutation on success.** `dataChain[operation_key] = result.data`
  AND `dataChain.$last = result.data` (`:564-566`). **Verify:** after a node,
  `$last` and the named slot both equal `result.data`; downstream `{{ $last }}`
  and `{{ <key> }}` resolve identically. _Watch-out:_ in the compiled driver the
  dataChain is **checkpointed to the execution row**; ensure both writes survive a
  resume.

- [ ] **Execution-log rows — running → success/failure.** Every op writes a
  `running` row at start (`:548-554`), then either a `success` row with
  `output_data` + `duration_ms` (`:569-577`) or a `failure` row with `error`,
  `error_stack`, `duration_ms` (`:582-591` for handler-returned failure,
  `:605-614` for thrown). **Verify:** row count + statuses per node match the live
  driver for a success flow AND a failure flow. _Observation:_ diff
  `visual_flow_execution_log` rows (see §4) — same `operation_key`, `status`
  sequence, non-null `duration_ms`.

- [ ] **`operation_id` FK on log rows (#704).** Live sets `operation_id =
  operation.db_operation_id` (the real DB op id, resolved at
  `execute-visual-flow.ts:303-308`, used :545,:550,:571,:584,:607) so the
  executions API can resolve the operation **name** — canvas node ids are not DB
  ids. **Verify:** log rows for a node that maps to a stored op carry the DB op
  id (not the canvas id); the compiled `CompiledNode.id` is the canvas/graph id,
  so the rewrite must ALSO carry `db_operation_id` (compiler currently drops it —
  `compiler.ts:25-35` has only `id/key/type/options/next`). **Gap flagged.**

- [ ] **`duration_ms` via `Date.now()` delta.** `startTime = Date.now()` →
  `Date.now() - startTime` (`:556,:561,:596`). Compiled unit must measure the
  handler call, not the whole step (which includes retries). **Verify:** duration
  is per-attempt and > 0.

- [ ] **Failure rethrows to abort the run.** A handler returning `success:false`
  throws `new Error(result.error || "Operation failed")` (`:593`); a thrown error
  propagates (`:616`). This bubbles to the step → triggers
  `initializeExecutionStep` **compensation** which marks the execution
  `cancelled` and emits `visual_flow_execution.failed` (`:188-251`). **Verify:**
  the compiled driver still aborts the run on a non-`continueOnError` failure AND
  fires the failure lifecycle (see §7). _Watch-out:_ the design (§7 of the engine
  design doc) proposes forward-only ops with `continueOnError`; that is a
  deliberate change — ensure the **default** stays "abort + failure event".

---

## 4. Error capture: describeFetchError + operation identity (#704)

- [ ] **undici `fetch failed` cause-unwrapping.** On a thrown error the live
  driver stores `describeFetchError(error)` as the log `error`
  (`execute-visual-flow.ts:602`, util `…/utils/describe-fetch-error.ts`), which
  unwraps `error.cause` (connect ETIMEDOUT / ECONNRESET / DNS) — the WhatsApp
  `notify_partner` incident otherwise stored a bare "fetch failed". **Verify:**
  _unit test_ — a node whose handler throws a `TypeError: fetch failed` with a
  `.cause` produces a log `error` containing the underlying cause string, not the
  opaque message. Compiled unit must call `describeFetchError` on the same path.

- [ ] **`error_stack` preserved.** Live stores `error.stack` (thrown,
  `:611`) or `result.errorStack` (handler-returned, `:589`). **Verify:** stack is
  non-null on failure rows under both.

- [ ] **Compensation digs the real op error out of the log.** When the step
  aborts, the workflow engine surfaces a generic "Workflow cancelled" message; the
  compensation re-reads the latest `status:"failure"` log row to recover the real
  `operation_key` + `error` (`:213-233`, `listVisualFlowExecutionLogs` with
  `take:1, order:created_at DESC`). **Verify:** the failure email / `failed`
  event carries the **operation-level** error, not the generic cancel string. The
  compiled driver keeps a failure-log row written BEFORE the throw so this lookup
  still works.

---

## 5. Option interpolation parity (the `{{ }}`-before-`Array.isArray` rule)

Ref: `reference_visual_flow_template_items_resolution`. Each op does its **own**
interpolation internally; the driver passes raw options. The compiled driver
must preserve this exactly — it must **not** pre-interpolate options before
calling the handler (only for the log row).

- [ ] **`interpolateVariables` semantics unchanged.** Full-string `{{ x }}`
  returns the **typed** value (object/array/number preserved); embedded tokens
  string-interpolate; objects/arrays recurse (`utils.ts:21-48`). Compiled path
  reuses the SAME `utils.ts` — do not reimplement. **Verify:** existing
  `operations/__tests__` stay green against the compiled driver.

- [ ] **`getValueByPath` `$`-alias fallback.** `{{ $read_data_123.x }}` falls back
  to `dataChain["read_data_123"]` when the `$`-key isn't a built-in
  (`utils.ts:54-84`, `BUILTIN_DOLLAR_KEYS`). **Verify:** a flow referencing an
  upstream op via `$<key>` resolves under both.

- [ ] **`bulk_update_data` interpolates `items` BEFORE `Array.isArray`.** The op
  resolves `options.items` (often a `{{ classify.update_items }}` template) via
  `interpolateVariables` first, THEN checks array-ness
  (`bulk-update-data.ts:83-93`). Guarding before interpolation silently no-ops the
  write (the cart-recovery `mark_sent` regression). Because the compiled driver
  passes **raw** options, this stays inside the op — **Verify:** integration —
  a `bulk_update_data` node fed a template string actually updates records (not 0)
  under the compiled driver. _Test:_ the existing bulk-update behavior must hold.

- [ ] **`bulk_*` / `trigger_workflow` template `items`.** Same pattern in
  `bulk-create-data`, `bulk-http-request`, `bulk-trigger-workflow`,
  `trigger-workflow` (per the reference note). **Verify:** spot-check each bulk op
  resolves a template `items`/payload at runtime.

- [ ] **`condition.filter_rule` interpolation.** `condition` interpolates
  `filter_rule` then `evaluateFilterRule` against the data chain
  (`condition.ts:34-49`); branch is `_branch: result ? "success" : "failure"`.
  **Verify:** `findNextOperations` branch routing (`execute-visual-flow.ts:637-645`,
  reads `result.data._branch`) is reproduced by the compiled driver's
  `next.success`/`next.failure` pruning.

- [ ] **`$last` drift on inserted log nodes.** Per the reference note, inserting a
  `log` node mid-chain shifts `$last`. Compiled `dataChain.$last` semantics must
  match (last-executed node's `result.data`). **Verify:** a chain with a `log`
  node between two ops resolves the same `$last` downstream.

---

## 6. Operation registry coverage (all 30 executors)

Every type registered in `operations/index.ts:71-116` must run identically under
the compiled driver (same handler, same context, same registry instance).

- [ ] **Logic:** `condition` (`condition.ts`), `wait_for_event`
  (`wait-for-event.ts`).
- [ ] **Data:** `create_data`, `read_data`, `update_data`, `delete_data`,
  `bulk_update_data`, `bulk_create_data`, `bulk_http_request`,
  `bulk_trigger_workflow`.
- [ ] **Communication:** `send_email`, `send_whatsapp`, `notification`,
  `marketing_daily_ideas_email`.
- [ ] **Integration:** `http_request`, `trigger_workflow`, `trigger_flow`,
  `ai_extract`, `ai_extract_platform`.
- [ ] **Utility:** `transform`, `log`, `sleep`, `execute_code`,
  `generate_partner_deeplink`.
- [ ] **Analytics:** `aggregate_product_analytics`, `aggregate_data`,
  `time_series`, `cart_recovery_stats`, `resolve_cart_recovery_urls`,
  `partner_analytics_digest`.
- [ ] **Verify:** an automated assert that `operationRegistry.getAll().length`
  matches the count the compiled driver can execute, so a newly-added op can
  never be unsupported by the new path silently.

### 6a. Special-case ops needing extra parity attention

- [ ] **`trigger_flow` (nested flow).** Invokes `executeVisualFlowWorkflow` for
  another flow (`operations/trigger-flow.ts` — one of the invocation sites). The
  compiled driver must be the executor both at top level AND when invoked as a
  nested flow; ensure no recursion into the OLD path. **Verify:** flow A triggers
  flow B; both run on the compiled driver; B's executions are logged.

- [ ] **`sleep` cap (5s, lost on restart).** `sleep` uses bounded `setTimeout`.
  The compiled path is where durable waits land (`wait_for_event` /
  `flow-wait.ts`). Keep `sleep` behaving identically until durable waits replace
  it; do not silently change `sleep`'s semantics.

---

## 7. Lifecycle events & execution-status state machine

- [ ] **`visual_flow_execution.started` emitted on init.** With `flow_id`,
  `flow_name`, `flow_metadata`, `flow_trigger_type` (the #418 schedule-start-email
  default-off signal), `execution_id`, `triggered_by`, `triggered_by_event`,
  `started_at` (`execute-visual-flow.ts:152-169`). Emit is **best-effort /
  swallow-errors** (`emitFlowLifecycleEvent:30-41`). **Verify:** subscriber that
  defaults schedule-flow start emails OFF still receives `flow_trigger_type`.

- [ ] **`visual_flow_execution.failed` emitted on abort.** With
  `failing_operation_key` + `error_message` recovered from the log
  (`:240-250`). **Verify:** payload parity field-by-field.

- [ ] **Status transitions.** `running` on init (`:138`), `completed` on success
  (`completeExecutionStep:396-400`), `failed` (`:401-407`), `cancelled` from
  compensation (`:235-238`). The compiled driver's checkpointing must drive the
  **same** terminal statuses. _Watch-out:_ today abort → compensation → `cancelled`;
  the design's forward-only model may make it `failed`. Pick one and document so
  dashboards/queries don't break.

- [ ] **`$trigger` log row + data-chain seed.** Init writes a `$trigger`
  `success` log (`:143-150`) and seeds `dataChain.$trigger` with spread trigger
  data + `.payload` back-compat + resolved `event` name + `timestamp`
  (`:111-127`); `$env` from `getAllowedEnvVars()` (`utils.ts:180-194`,
  NODE_ENV/PUBLIC_URL only); `$accountability.triggered_by`; `$last: null`.
  **Verify:** the compiled driver seeds an IDENTICAL initial data chain (a flow
  reading `{{ $trigger.id }}` / `{{ $env.PUBLIC_URL }}` resolves the same).

- [ ] **Event-name precedence.** `metadata.event_name` → `trigger_config.event`
  → `trigger_config.event_type` (`:105-109`). **Verify:** wildcard-listener flow
  gets the concrete event in `$trigger.event`.

---

## 8. Durable waits — suspend/resume (#463 / #459 slice 4)

The live `wait_for_event` op is a **marker only** — it echoes wait config and
returns `success` (`wait-for-event.ts:46-58`); it does NOT suspend the running
graph. The durable suspend/resume primitive exists separately in
`flow-wait.ts` (async step, `setStepSuccess` resume via
`api/admin/visual-flows/waits/[transaction_id]/resume/route.ts`) but is **not yet
wired into the executor**.

- [ ] **Parity baseline = marker behavior.** Until slice 4, the compiled driver
  must treat `wait_for_event` exactly as today (echo config, continue) so cutover
  doesn't change current flows. **Verify:** a flow with a `wait_for_event` node
  runs through to completion under both drivers (no suspend).

- [ ] **Resume addressing prerequisite (forward-looking).** When durable waits
  ARE wired, the per-op unit must expose its `transactionId` and persist it on the
  `visual_flow_execution` row so the resume route can target the suspended step
  (engine-design §3, open question on `setStepSuccess` addressing). Not required
  for cutover parity, but the driver design must not foreclose it.

- [ ] **`flow-wait.ts` execution rows stay observable.** It opens a `running`
  execution + `$wait` log, closes to `completed` on resume / `cancelled` on
  timeout (`flow-wait.ts:36-97`). Ensure the compiled driver doesn't collide with
  or duplicate these rows.

---

## 9. Compile-on-save / plan-cache correctness (already built — guard it)

- [ ] **Plan persisted on save.** `compileFlowPlanStep` (`visual-flow-steps.ts:264`)
  → `cacheCompiledPlan`; service `compileAndPersistPlan` writes `compiled_plan` +
  `compiled_hash` (`service.ts:38-59`); columns on `visual-flow` model
  (`models/visual-flow.ts:29-30`, migration `Migration20260617000000`). **Verify:**
  saving a flow updates both columns; `block:true` on activate throws on invalid
  graph.

- [ ] **Read precedence at exec.** Compiled driver must read Redis
  (`getCachedCompiledPlan`, keyed `vflow:plan:{flowId}:{hash}`,
  `flow-plan-cache.ts:20`) → column (`getCompiledPlan`, `service.ts:65-68`) →
  recompile fallback. **Verify:** cache miss falls back to column; stale flow
  with no `compiled_plan` recompiles lazily (back-compat, engine-design §5).

- [ ] **Hash invalidation.** `compiled_hash` changes on any structural edit
  (`stableHash` over version/entrypoints/levels/nodes, `compiler.ts:120-129`), so
  a save implicitly invalidates the cache. **Verify:** editing a node's options
  changes the hash and the next run uses the new plan.

- [ ] **Warnings vs errors discipline.** Option/Zod mismatches are **warnings**
  (raw `{{ }}` tokens resolve at runtime — `compiler.ts:160-169`,
  `hasTemplateTokens`); only cycles / unknown types / dangling edges / no
  entrypoint are hard errors. **Verify:** a flow with `{{ }}` tokens in options
  compiles `ok:true` (warnings allowed), activation not blocked.

---

## 10. `execute_code` / isolated-vm guards (#494)

- [ ] **Default in-process runner unchanged.** `execute_code` uses
  `new Function(...)` by default (`execute-code.ts:354-401,618-636`); the
  compiled driver passes raw options so this is internal to the op. **Verify:**
  an `execute_code` node returns identical output under both drivers.

- [ ] **Template-token binding (type-preserving).** `bindTemplateTokens` binds
  raw `{{ }}` values into the sandbox under generated identifiers — no
  JSON-stringify round-trip (`execute-code.ts:112-124,283-293`). **Verify:**
  `JSON.parse({{ $last }})` and `const x = {{ $last }}` receive real values.

- [ ] **`$`-alias exposure + validation whitelist.** `dollarAliases` +
  `validateCode` known-identifier set (`execute-code.ts:133-141,146-213,296`).
  **Verify:** code referencing `$read_data_123` passes validation under both.

- [ ] **Blocked packages.** `BLOCKED_PACKAGES` (child_process/fs/net/…) refused
  in BOTH isolated and in-process branches (`execute-code.ts:16-32,324-332,
  360-367`). **Verify:** requesting `fs` is rejected.

- [ ] **isolated-vm opt-in stays OFF by default.** `isIsolatedVmEnabled()` gated
  on `VFLOW_USE_ISOLATED_VM` (`isolated-runner.ts:47-50`), lazy indirect import
  so prod (addon absent) is unaffected (`isolated-runner.ts:168-183` — the
  `specifier: string` indirection, ref
  `reference_optional_native_dep_breaks_prod_build`). **Verify:** prod build
  succeeds; with flag off behavior is the in-process runner. The compiled driver
  must NOT flip this default.

- [ ] **isolated mode rejects external npm + bridges built-ins.** External
  packages error in isolated mode (`execute-code.ts:336-345`); lodash/dayjs/
  validator UMD evaluated inside the isolate; crypto/uuid/sleep bridged
  (`isolated-runner.ts:57-127,224-316`). **Verify (only if flag enabled):** a flow
  requesting an external package errors clearly; built-ins work.

---

## 11. Idempotency / re-entrancy on retries

The whole point of the compiled driver is resume-from-failure (engine-design
§2b). The live single-step driver is **NOT** idempotent across step retries (a
retry re-runs the entire step from the top, re-sending emails) — the `visited`
set lives only within one step invocation. This is a **gain**, but it must not
introduce double-execution.

- [ ] **Checkpoint `completed` set persisted per node.** After each node
  succeeds, the driver persists `completed` + `dataChain` to the execution row so
  a step retry skips done nodes. **Verify:** _integration_ — kill/retry the
  driver step mid-flow; completed side-effects (emails/writes) do NOT repeat;
  remaining nodes run once.

- [ ] **No double-exec across resume.** Combined with §2 diamond guard:
  `completed` must be the union of (within-run visited) ∪ (checkpointed-before-
  crash). **Verify:** crash after node B in A→B→D, resume → D runs once, B not
  re-run.

- [ ] **Log rows not duplicated on resume.** A resumed node must not append a
  second `running`/`success` pair. **Verify:** log row count per node == 1 success
  (+ at most 1 running) after a resume.

- [ ] **Lifecycle events not re-emitted on resume.** `started` fires once per
  execution, not once per step retry. **Verify:** one `started` event per
  execution id even across retries.

---

## 12. Invocation-site parity (every entry point must hit the new driver)

All current callers of `executeVisualFlowWorkflow` must run the compiled driver
(no caller left on the old path). Sites (grep `executeVisualFlowWorkflow`):
- `…/workflows/visual-flows/index.ts` (barrel)
- `…/api/admin/visual-flows/[id]/execute/route.ts` (manual run)
- `…/api/webhooks/flows/[id]/route.ts` (webhook trigger)
- `…/subscribers/visual-flow-event-trigger.ts` (event trigger)
- `…/jobs/run-scheduled-visual-flows.ts` (schedule scanner)
- `…/modules/visual_flows/operations/trigger-flow.ts` (nested flow)

- [ ] **Feature-flag flip is global.** Behind `VFLOW_DURABLE_EXECUTOR`
  (engine-design §5) the workflow id stays `execute-visual-flow` so all six
  callers are switched at once. **Verify:** each entry point produces an execution
  on the compiled driver in shadow mode (§4).

---

## 13. Shadow-run plan (run both, diff, then flip)

Goal: run the compiled driver **alongside** the live driver on real flows and
prove output equivalence BEFORE flipping `VFLOW_DURABLE_EXECUTOR` in prod.

### 13.1 Mechanism
- Add a **shadow mode** (env `VFLOW_SHADOW_EXECUTOR=true`): the live driver runs
  normally (authoritative, real side-effects); immediately after, the compiled
  driver runs the SAME flow + trigger data in a **dry/side-effect-suppressed**
  mode that writes to a **parallel** execution + log table (or tags rows
  `shadow:true`) and **must not** send emails / WhatsApp / external HTTP / DB
  writes. Implement suppression by a context flag the ops honor, OR by running
  shadow only for read-only / pure flows first (see sampling).
- Never let the shadow path mutate production data or emit lifecycle events.

### 13.2 Which flows to sample (in order, lowest-risk first)
1. **Pure/read-only flows** — `read_data`, `aggregate_*`, `time_series`,
   `condition`, `transform`, `log`. No suppression needed; safest first signal.
2. **Branching flows** — at least one `condition` with both `success`/`failure`
   paths exercised, and one **diamond** (A→B→D, A→C→D) to prove the §2 join/dedup
   parity.
3. **Bulk + template flows** — a `bulk_update_data` / `bulk_trigger_workflow` fed
   a `{{ }}` template `items` (the §5 regression class), in suppressed mode.
4. **Side-effecting flows** — `send_email` / `send_whatsapp` / `http_request` /
   `trigger_workflow`, suppressed. The cart-recovery flow is a must-include
   (it exercised the bulk-update no-op bug).
5. **Nested + code flows** — a `trigger_flow` chain and an `execute_code` node.
- Sample the **top N most-executed active flows** from
  `visual_flow_execution` history, plus one of each trigger type (manual / event
  / webhook / schedule) so all §12 entry points are covered.

### 13.3 What to compare (per execution)
For the same `flowId` + `triggerData`, diff:
- **Terminal status** — `completed` vs `completed`, `failed`/`cancelled` parity.
- **Per-node log rows** — same set of `operation_key`s, same `status` sequence
  (running→success/failure), `operation_id` populated (#704), `duration_ms`
  non-null. Order of side-effecting nodes matches §1 position-ordering.
- **Final data chain** — deep-equal `dataChain` minus volatile fields
  (`timestamp`s, generated ids, `duration_ms`). Normalize before diffing.
- **`$last` and each named slot** — equal values.
- **Branch taken** — condition nodes route to the same next nodes.
- **Error fidelity on failures** — same `error` (post-`describeFetchError`),
  `error_stack` present, failure event `failing_operation_key` matches.
- **Side-effect count** — in suppressed mode, assert the compiled path attempted
  the SAME external calls (capture intended calls to a log) as the live path
  actually made.

### 13.4 Tooling
- A diff job/script reads the live execution row + its logs and the shadow
  row + logs for the same trigger and emits a structured diff (fields that
  differ). Run it over the sampled set; collect a pass/fail per flow.
- Keep a **golden-fixture** unit layer too: serialize a handful of real flows +
  trigger payloads and assert compiled-driver output equals a recorded live
  baseline (catches regressions in CI, not just in shadow).

### 13.5 Success criteria (all must hold)
- 100% terminal-status parity across the sampled set.
- 0 unexplained per-node log diffs (volatile fields excluded).
- 0 data-chain value diffs (volatile fields excluded).
- 0 missing/extra side-effect attempts in suppressed mode.
- Diamond + cycle + branch + bulk-template cases each verified green (§2, §5).
- A deliberate failure flow reproduces the same operation-level error + failure
  event (§4).
- Run clean for a sustained window (e.g. ≥1 week of shadow traffic or ≥N
  executions per sampled flow) with zero new diffs.

---

## 14. The cutover gate (explicit)

> **DO NOT set `VFLOW_DURABLE_EXECUTOR=true` in production until:**
> 1. Every checkbox in §1–§12 is checked, each with its named test/observation green.
> 2. The shadow-run (§13) meets ALL success criteria over the sustained window.
> 3. The dead `execution-engine.ts` is already removed (done — #469) so there is
>    exactly one executor after the flip.
> 4. Rollback is one env flip back (`VFLOW_DURABLE_EXECUTOR=false`) and is tested.
>
> Flip in a low-traffic window; watch `visual_flow_execution` failure rate +
> lifecycle failure events for one full schedule cycle before declaring done.

### Known gaps the rewrite MUST close (flagged above)
- `CompiledNode` does **not** carry `position_x/position_y` → §1 ordering would
  regress. Add them in the compiler.
- `CompiledNode` does **not** carry `db_operation_id` → §3 `operation_id` FK
  (#704) would regress. Add it (compiler must thread the DB op id like the live
  driver does at `execute-visual-flow.ts:303-308`).
- Join semantics (§2) and terminal status on abort (§7) are **deliberate
  behavior decisions** — resolve and document before cutover, don't let them
  drift.
</content>
</invoke>
