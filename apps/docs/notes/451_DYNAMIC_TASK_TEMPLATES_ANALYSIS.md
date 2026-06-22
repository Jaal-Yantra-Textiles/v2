# #451 — Dynamic Task Templates: Action Contract Analysis

## 1. Summary & Goal

The user wants to attach **actions** to task templates — declarative behaviours that run automatically when a materialised task reaches a lifecycle moment (created, assigned, started, completed, cancelled). Currently a template can only set two boolean flags (`eventable`, `notifiable`) that emit a single `task_assigned` event or drive a notification with a static `message_template`. This doc defines a first-class **Action descriptor** schema, analyses how it binds to the template model, how it snapshots onto tasks, and how it executes via the existing **visual-flows operation registry**.

## 2. Current State

### 2.1 TaskTemplate model

`apps/backend/src/modules/tasks/models/tasktemplate.ts:10` — `TaskTemplate` (table `task_template`) with fields: `name`, `description`, `category` (belongsTo `TaskCategory`, nullable), `estimated_duration`, `priority` enum(low/medium/high), `required_fields` (json), `estimated_cost`/`cost_currency`, **`eventable`** (bool, default false), **`notifiable`** (bool, default false), **`message_template`** (text, nullable), `metadata` (json).

`TaskCategory` at `tasktemplate.ts:3` (table `task_category`): `id`, `name`, `description`, `metadata`.

### 2.2 Task model

`apps/backend/src/modules/tasks/models/task.ts:5` — `Task` (table `task`): `title`, `description`, `start_date`/`end_date`, `status` enum(pending/in_progress/completed/cancelled/accepted/assigned), `priority`, `transaction_id`, **`eventable`** (bool), **`notifiable`** (bool), **`message`** (text), `assigned_to`/`assigned_by`, cost fields, `metadata`, `completed_at`, dependency relations (`outgoing`/`incoming` → `TaskDependency`), parent/subtasks self-relation.

### 2.3 Template → Task instantiation

- **`createTaskWorkflow`** at `apps/backend/src/workflows/tasks/create-task.ts:259` — handles `template_ids`/`template_names`/`child_template_ids`. Routes through `createTaskWithTemplatesStep`, `createTaskWithParentStep`, or `createTaskDirectlyStep` based on input analysis.
- **`createTasksFromTemplatesWorkflow`** (designs) at `apps/backend/src/workflows/designs/create-tasks-from-templates.ts:78` — calls `createTaskWorkflow.runAsStep`, emits `designTaskCreated` hook.
- **`createTasksFromTemplatesWorkflow`** (inventory orders) at `apps/backend/src/workflows/inventory_orders/create-tasks-from-templates.ts:147` — same pattern, emits `inventoryOrderTaskCreated` hook.
- **`TaskService.createTaskWithTemplates`** at `apps/backend/src/modules/tasks/service.ts:16` — maps template fields onto each new task: copies `eventable`, `notifiable`, `estimated_cost`, `cost_currency`, and merges `template.id`/`template.name` into `task.metadata`.

### 2.4 The ONLY existing action primitives

1. **`eventable`** flag + `task_assigned` subscriber: `apps/backend/src/subscribers/task-assigned.ts:10` — listens for the `task_assigned` event and runs `sendPartnerTaskAssignedWorkflow`. Emitted by `runTaskAssignmentWorkflow` (`apps/backend/src/workflows/tasks/run-task-assignment.ts`).
2. **`notifiable`** flag + **`message_template`**: drives in-app notifications via `notification.ts` and partner-bell, but the current template→task path (`service.ts:35-36`) only copies the boolean — the template's `message_template` string is NOT copied onto the task's `message` field. **This is a gap** — the template `message_template` is never propagated.

**Conclusion**: The action contract is currently `{ eventable: boolean, notifiable: boolean, message_template: string | null }` — a flat boolean pair with one optional text field. No rich descriptors, no trigger lifecycle, no type dispatch.

## 3. Proposed Action Contract

### 3.1 Action descriptor schema

```typescript
// Zod schema (proposed)
const actionDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),               // human label, e.g. "Email designer"
  trigger: z.enum([
    "on_create",     // task just created
    "on_assign",     // task assigned to someone
    "on_start",      // status → in_progress
    "on_complete",   // status → completed
    "on_cancel",     // status → cancelled
  ]),
  type: z.enum([
    "notify",              // in-app/partner-bell notification
    "send_whatsapp",       // WhatsApp message via social-provider
    "send_email",          // email via notification system
    "trigger_visual_flow", // run an existing visual flow
    "trigger_workflow",    // run a Medusa workflow by name
    "create_subtask",      // create a child task from another template
    "http_request",        // external webhook/callback
    "set_field",           // set a task field on completion
  ]),
  config: z.record(z.string(), z.any()),  // type-specific parameters
  condition: z.string().optional(),       // optional predicate expression
  enabled: z.boolean().default(true),
});
```

### 3.2 Field semantics

| Field | Purpose |
|---|---|
| `id` | Stable identifier within the actions array; used for ordering and mutation. |
| `name` | Display label for admin UI. |
| `trigger` | Which lifecycle moment fires this action. |
| `type` | What the action **does** — see mapping below. |
| `config` | Operation-specific parameters (passed directly to the visual-flows operation `options` after interpolation). |
| `condition` | Optional CEL-like or simple equality-expression string; evaluated against task data at trigger time. Empty/missing means "always run". |
| `enabled` | Soft on/off switch; disabled actions are preserved but skipped. |

### 3.3 Action `type` → visual-flows operation mapping

Every action type maps to an existing `OperationDefinition` registered in the `operationRegistry` (`apps/backend/src/modules/visual_flows/operations/types.ts:88`). The action-runner can **reuse the same `execute` function**, avoiding a second dispatch engine.

| Action `type` | Visual-flows operation | file | `op.type` |
|---|---|---|---|
| `send_whatsapp` | `sendWhatsAppOperation` | `apps/backend/src/modules/visual_flows/operations/send-whatsapp.ts:29` | `send_whatsapp` |
| `send_email` | `sendEmailOperation` | `apps/backend/src/modules/visual_flows/operations/send-email.ts:5` | `send_email` |
| `trigger_visual_flow` | `triggerFlowOperation` | `apps/backend/src/modules/visual_flows/operations/trigger-flow.ts:15` | `trigger_flow` |
| `trigger_workflow` | `triggerWorkflowOperation` | `apps/backend/src/modules/visual_flows/operations/trigger-workflow.ts:7` | `trigger_workflow` |
| `http_request` | `httpRequestOperation` | `apps/backend/src/modules/visual_flows/operations/http-request.ts:5` | `http_request` |
| `notify` | `notificationOperation` | `apps/backend/src/modules/visual_flows/operations/notification.ts:6` | `notification` |
| `wait_for_event` | `waitForEventOperation` | `apps/backend/src/modules/visual_flows/operations/wait-for-event.ts:18` | `wait_for_event` |

**`create_subtask`** and **`set_field`** have no corresponding visual-flows op — they need **new** lightweight `OperationDefinition` entries (proposed files: `apps/backend/src/modules/tasks/actions/create-subtask-action.ts` and `set-field-action.ts` — proposed). These would register under a new operation registry or directly in the action-runner.

## 4. How Actions Bind to a Template

### Option A: JSON `actions` field on `task_template` (recommended for MVP)

Add an `actions: model.json().nullable()` column to the `TaskTemplate` model — mirrors the existing `required_fields: model.json().nullable()` precedent exactly (`apps/backend/src/modules/tasks/models/tasktemplate.ts:21`). No new model, no migration beyond an ALTER TABLE ADD COLUMN, no new Medusa module link.

**Pros**: Fastest to ship; the data lives on the template row; no new DB reads for cascade queries; admin CRUD reuses existing template update/delete workflows; the `required_fields` json field proves the pattern works.

**Cons**: Not independently queryable; actions cannot be shared across templates without duplication; no ordering column (must rely on array index in JSON, which is fragile under concurrent updates).

### Option B: Child model `TaskTemplateAction` (recommended for post-MVP)

A new model `TaskTemplateAction` (proposed file `apps/backend/src/modules/tasks/models/task-template-action.ts`) with a `belongsTo` link to `TaskTemplate`, plus `hasMany` back. Fields: `trigger` enum, `type` enum, `config` json, `condition` text nullable, `enabled` bool, `sort_order` int.

**Pros**: Queryable, orderable, shareable across templates via a pivot or reusable-action table; supports independent CRUD (reorder actions without rewriting the whole JSON array).

**Cons**: New model, new migration, new MedusaService registration (`apps/backend/src/modules/tasks/service.ts:6`), new admin hooks + routes. Significantly more work.

### Recommendation

Ship **Option A first** (json `actions` field), then **Option B if/when** users need to share action configurations across templates or independently query/order them. The `required_fields` json field at `apps/backend/src/modules/tasks/models/tasktemplate.ts:21` is the direct precedent.

## 5. Snapshot Actions onto Task at Instantiation

When `createTasksFromTemplatesWorkflow` / `createTaskWorkflow` / `TaskService.createTaskWithTemplates` materialises a task from a template, the template's `actions` array must be **snapshotted** onto the task so later template edits don't retroactively change in-flight tasks.

### Implementation points

1. **`TaskService.createTaskWithTemplates`** at `apps/backend/src/modules/tasks/service.ts:28-52` — the template→task mapping loop at lines 28-52 currently copies `eventable`/`notifiable` from the template. Add a line that copies `template.actions` into `taskData.metadata.actions` (or a dedicated `actions` json column on `Task`, after adding one). The snapshot happens **before** `this.createTasks(tasksToCreate)` at line 56.

2. **`createTaskWorkflow`** at `apps/backend/src/workflows/tasks/create-task.ts` — the `createTaskWithTemplatesStep` (line 206) calls `TaskService.createTaskWithTemplates`, so the snapshot is already handled there. The `createTaskDirectlyStep` (line 74) creates tasks without templates — no snapshot needed.

3. **Snapshot storage** — two options:
   - **`task.metadata.actions`** (zero migration, uses existing `metadata: model.json()` at `apps/backend/src/modules/tasks/models/task.ts:32`). This is the `context_snapshot` pattern already present — the metadata field on task already stores `template_id` and `template_name` (`service.ts:43-48`).
   - **New `actions` json column** on `Task` (same pattern). Simpler to query/filter if needed later.

   Recommend `task.metadata.actions` for zero migration cost.

## 6. How Actions Execute

### 6.1 Lifecycle subscriber

**Extend** the existing subscriber pattern at `apps/backend/src/subscribers/task-assigned.ts` with a **general-purpose lifecycle subscriber** (proposed file `apps/backend/src/subscribers/task-lifecycle.ts`):

```typescript
// Proposed subscription
export const config: SubscriberConfig = {
  event: ["task.created", "task.updated", "task_assigned"],
};
```

Emit new lifecycle events from the task workflows:

- `task.created` — emitted after `createTaskWorkflow` completes (at `apps/backend/src/workflows/tasks/create-task.ts:334`, the `taskCreatedHook` already exists but is a workflow hook, not an event — expose it as a Medusa event via the event bus).
- `task.updated` — when status changes to `in_progress`, `completed`, `cancelled` (currently **not emitted** — needs new event emission in the update-task workflow).
- `task_assigned` — already emitted by `runTaskAssignmentWorkflow` at `apps/backend/src/workflows/tasks/run-task-assignment.ts`.

### 6.2 Action runner

The subscriber receives the task (with its snapshotted `actions` from `task.metadata.actions`), filters actions by `enabled` and `trigger` matching the event type, evaluates `condition` against the task data, then dispatches each action through a thin **ActionRunner** (proposed `apps/backend/src/modules/tasks/actions/action-runner.ts`):

```typescript
// Pseudocode (proposed)
class ActionRunner {
  async run(action: ActionDescriptor, context: { task, eventData }) {
    const op = operationRegistry.get(this.actionTypeToOpType(action.type));
    if (!op) throw new Error(`No handler for action type: ${action.type}`);
    return op.execute(action.config, {
      container,
      dataChain: buildDataChain(task, eventData),
      flowId: `task-action-${task.id}`,
      executionId: generateId(),
      operationId: action.id,
      operationKey: action.id,
    });
  }
}
```

### 6.3 Why async subscriber, not sync in workflow

Run actions **in the subscriber**, not inside `createTaskWorkflow` or `updateTaskWorkflow`:

- Workflows should remain fast — actions (especially `http_request`, `send_whatsapp`, `trigger_visual_flow`) add latency.
- Actions may fail independently; per-action error isolation is simpler in the subscriber.
- Visual-flows operations already handle errors gracefully (`success: false` + `error` in `OperationResult`).

## 7. Reuse-vs-New

**Do NOT build a parallel automation engine.** Reuse:

| Component | Already exists | Used for |
|---|---|---|
| Tasks module (`apps/backend/src/modules/tasks/`) | ✓ | Task + Template models, service, CRUD |
| Visual-flows `operationRegistry` (`apps/backend/src/modules/visual_flows/operations/types.ts:88`) | ✓ | Action dispatch by type |
| Visual-flows `OperationDefinition.execute` | ✓ | Each action type's actual side effect |
| Event bus + subscribers | ✓ | `task_assigned`, `task.created`, `task.updated` |
| `createHook` | ✓ | `taskCreatedHook` at `create-task.ts:334`, `designTaskCreated` at `create-tasks-from-templates.ts:105` |

**New (thin):**

| Component | Reason |
|---|---|
| Action zod schema + validator | Define the contract |
| `actions` json on `TaskTemplate` | Store actions on template |
| Snapshot in `service.ts:createTaskWithTemplates` | Copy actions to task at creation |
| Subscriber `task-lifecycle.ts` | Listen for lifecycle events, run actions |
| `action-runner.ts` | Filter → evaluate condition → dispatch via `operationRegistry` |
| `create-subtask-action.ts`, `set-field-action.ts` | Two new `OperationDefinition` entries for actions without a v-flow equivalent |

## 8. PR-by-PR Plan

### PR1 — Action zod schema + pure validator

- Define `actionDescriptorSchema` (proposed: `apps/backend/src/modules/tasks/actions/action-schema.ts`).
- Define `TaskTemplateActions` type (array of descriptors).
- Export the schema + validator function.
- **Test strategy**: Unit tests for schema validation (valid/invalid actions, required fields, enum values, condition syntax). No DB needed.

### PR2 — Add `actions` json to `TaskTemplate`

- Add `actions: model.json().nullable()` to `apps/backend/src/modules/tasks/models/tasktemplate.ts`.
- Add migration: ALTER TABLE `task_template` ADD COLUMN `actions` json NULL.
- Add `actions: z.array(actionDescriptorSchema).optional()` to `taskTemplateSchema` at `apps/backend/src/api/admin/task-templates/validators.ts:10`.
- Add `actions` to `CreateTaskTemplateInput` type at `apps/backend/src/workflows/task-templates/create-template.ts:10` and `UpdateTaskTemplateInput` at `apps/backend/src/workflows/task-templates/update-template.ts:13`.
- **Test strategy**: Integration test — POST/PUT a template with `actions`, GET it back, verify JSON roundtrips. Nil actions → stored as null.

### PR3 — Snapshot actions onto task at instantiation

- In `TaskService.createTaskWithTemplates` at `apps/backend/src/modules/tasks/service.ts:43-48` — add `actions: (template as any).actions ?? []` to the metadata merge.
- Ensure actions flow through `createTaskWorkflow.createTaskWithTemplatesStep` at `apps/backend/src/workflows/tasks/create-task.ts:206`.
- **Test strategy**: Integration test — create template with actions, create task from template via API, retrieve task, verify `task.metadata.actions` matches template's `actions`.

### PR4 — Action-runner + lifecycle subscriber

- Build `ActionRunner` class (proposed: `apps/backend/src/modules/tasks/actions/action-runner.ts`) that receives an action descriptor and dispatches via `operationRegistry.get(...).execute(...)`.
- Create subscriber `apps/backend/src/subscribers/task-lifecycle.ts` (proposed) that listens for `task.created`, `task.updated` (status changes), `task_assigned`; reads `task.metadata.actions`; filters by trigger + enabled + condition; runs each action through the ActionRunner.
- Create `create-subtask-action.ts` and `set-field-action.ts` `OperationDefinition` entries (proposed: `apps/backend/src/modules/tasks/actions/`).
- Wire `task.created` event emission from `createTaskWorkflow`'s existing `taskCreatedHook`.
- Wire `task.updated` event from update-task workflow for status transitions.
- **Test strategy**: Unit tests for ActionRunner (mock `operationRegistry`), integration test for subscriber (create task → verify action was dispatched). New `OperationDefinition` entries get unit tests with mocked services.

### PR5 — Admin UI for editing actions on a template

- Extend `apps/backend/src/admin/components/creates/create-task-template.tsx` — add hot-reloadable action list UI (action type selector, trigger dropdown, dynamic config form per type, enabled toggle, add/remove/reorder).
- Extend the edit/detail template page (proposed) — same Action list form, loaded from template's `actions` field.
- Add action type descriptions loaded from `operationRegistry.getDefinitionsForUI()` (`apps/backend/src/modules/visual_flows/operations/types.ts:114`).
- **Test strategy**: Component-level tests for the action editor form; E2E test — admin creates a template with 2 actions, saves, reopens, verifies they persisted.

### PR6 — Wire more triggers/types

- Add `on_create` emission from `createTaskWorkflow` (new Medusa event via event bus).
- Add `on_start` / `on_complete` / `on_cancel` emissions from the update-task workflow.
- Audit existing `task.updated` hooks — currently missing from status transitions.
- **Test strategy**: Integration tests for each trigger — create/update a task, assert the correct event fires, assert the correct actions run.

## 9. Open Questions / Product Decisions

1. **Which triggers first?** — `on_create` and `on_complete` are the most common (auto-notify on task creation, webhook on completion). `on_assign` already exists as `task_assigned`. Recommend: PR4 covers `on_create` + `on_assign`; PR6 adds `on_start`, `on_complete`, `on_cancel`.

2. **Sync vs async execution?** — Strongly recommend **async (subscriber)** as described in §6.3. However, some actions (e.g. `set_field`) could be sync within the workflow. Decision: start async-only; add sync-async flag later if needed.

3. **Per-action error isolation?** — Yes: if action A fails, action B should still run. Currently visual-flows `OperationResult` supports this naturally — the subscriber iterates actions and collects `{ id, success, error }` per action.

4. **Admin-only or partner-authorable?** — For MVP, **admin-only**. The action configurations (`config` blocks) may contain sensitive values (webhook URLs, API endpoints). Partner-authorable actions require a permission model and scoped action types.

5. **Condition expression language?** — Start simple: **field-equality only** (`status == "completed"`, `assigned_to != null`). Use a tiny expression evaluator (or just `eval` behind a strict allowlist if the expressions are template-authored). Full predicate language (CEL/JSONPath) can follow if needed. The `condition` field is `string` for flexibility.

6. **Compatibility with existing `eventable`/`notifiable`?** — Migrate: when reading a template, if `eventable: true` and no explicit `on_assign` action exists, auto-generate an `on_assign` action of type `notify` (or just keep the existing subscriber alive). The old boolean path can be deprecated but not removed until all templates are migrated.

7. **Should snapshot semantics include the action's `config` at creation time?** — Yes. The snapshot copies the `actions` array **by value** into `task.metadata.actions`. Template edits after instantiation do NOT affect already-created tasks. This is already the pattern for `template_id`/`template_name` in `service.ts:43-48`.
