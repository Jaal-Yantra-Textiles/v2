# Visual Flow codemap — skeleton for authoring a new flow

A "visual flow" is an operator-editable automation: an **event / schedule / webhook /
manual / another_flow** trigger drives a graph of typed operations (read data,
condition, send email, etc.). Flows are stored in the `visual_flows` module and
executed by a subscriber that matches fired events against active flows.

This doc is the **skeleton** for adding a new pre-built flow: author a `FLOW_DEF`
seed script, then wrap it in an idempotent Data Plumbing "Install flow" job so
admins can seed it (dry-run → apply) without shell access.

---

## Key files

| Purpose | Path |
|---|---|
| **Event → flow subscriber** (registers trigger event list) | `apps/backend/src/subscribers/visual-flow-event-trigger.ts` |
| Flow model | `apps/backend/src/modules/visual_flows/models/visual-flow.ts` |
| Operation model (**operation type enum**) | `apps/backend/src/modules/visual_flows/models/visual-flow-operation.ts` |
| Operation impls (e.g. `send_email`) | `apps/backend/src/modules/visual_flows/operations/*.ts` |
| Execution engine (data chain, topo order) | `apps/backend/src/workflows/visual-flows/execute-visual-flow.ts` |
| Service — `createCompleteFlow()` | `apps/backend/src/modules/visual_flows/service.ts` |
| Data Plumbing registry (wrap FLOW_DEF as a job) | `apps/backend/src/api/admin/ops/maintenance-jobs/registry.ts` |
| **Template seed scripts** (mirror these) | `apps/backend/src/scripts/seed-inventory-order-status-flow.ts`, `seed-partner-payment-status-flow.ts`, `seed-partner-product-create-flow.ts`, `seed-marketing-daily-ideas-email-flow.ts` |

---

## 1. Register the trigger event

In `visual-flow-event-trigger.ts` the subscriber's `config.event[]` array must
list every event a flow can trigger on. Three trigger-config shapes (precedence):

1. `event_pattern: "production_run.*"` — shell-style glob (`*`→`.*`, `?`→`.`)
2. `event_types: ["a", "b"]` — array of exact names
3. `event_type: "a"` — single exact name (legacy)

Matched flows execute **detached / fire-and-forget** (a slow flow never stalls the
event bus). Already registered incl.: `partner_product.proposed|approved|rejected`.

## 2. Flow model shape

```
visual_flow: {
  id ("vflow…"), name, description, icon, color,
  status: "active" | "inactive" | "draft",       // only "active" executes
  trigger_type: "event" | "schedule" | "webhook" | "manual" | "another_flow",
  trigger_config: json,                           // shape depends on trigger_type
  canvas_state: json { nodes[], edges[], viewport },
  compiled_plan, compiled_hash, metadata,
  operations: hasMany, connections: hasMany, executions: hasMany,
}
```

## 3. Operation types (the node palette)

`condition · create_data · read_data · update_data · delete_data ·
bulk_update_data · bulk_create_data · bulk_http_request · bulk_trigger_workflow ·
http_request · run_script · send_email · send_whatsapp · notification · transform ·
trigger_workflow · trigger_flow · execute_code · sleep · log · ai_extract ·
ai_extract_platform · ai_generate · aggregate_product_analytics ·
generate_partner_deeplink`

### `send_email` options
```
{ to, subject, template?: "visual-flow-email", body?, data?: {} }   // all interpolate {{ }}
```
Runs `sendNotificationEmailWorkflow` (fallback: `Modules.NOTIFICATION`). Returns
`{ success, data: { to, subject, sent_via } }`.

## 4. Data chain (interpolation context, `{{ }}`)

```
$trigger:        { ...eventData, payload, event: "partner_product.approved", timestamp }
$accountability: { triggered_by }
$env:            { ...allowedEnvVars }
$last:           result of previous op
[operation_key]: each op's output keyed by its operation_key
```

## 5. Seed via `createCompleteFlow()`

```ts
await service.createCompleteFlow({
  flow: { name, description, status, trigger_type, trigger_config, canvas_state, metadata? },
  operations?: [{ operation_key, operation_type, name?, options?, position_x?, position_y?, sort_order? }],
  connections?: [{ source_id, source_handle?, target_id, target_handle?, connection_type? }],
})
```
`source_id: "trigger"` is the trigger node. `source_handle`/`connection_type`:
`"success" | "failure" | "default"`.

---

## Skeleton: event flow → branch → send email

```ts
// apps/backend/src/scripts/seed-<name>-flow.ts
export const FLOW_DEF = {
  flow: {
    name: "<Unique Name>",                 // idempotency key — refuse to overwrite by name
    description: "…",
    status: "active",                       // or "draft" until reviewed
    trigger_type: "event",
    trigger_config: { event_types: ["partner_product.approved", "partner_product.rejected"] },
    canvas_state: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  },
  operations: [
    { operation_key: "read_partner", operation_type: "read_data",  name: "Load partner", options: {/* … */} },
    { operation_key: "is_approved",  operation_type: "condition",  name: "Approved?",    options: {/* {{ $trigger.event }} == … */} },
    { operation_key: "email_ok",     operation_type: "send_email", name: "Approved email",
      options: { to: "{{ read_partner.email }}", subject: "…", template: "…", data: {/* … */} } },
    { operation_key: "email_no",     operation_type: "send_email", name: "Rejected email",
      options: { to: "{{ read_partner.email }}", subject: "…", template: "…", data: { reason: "{{ $trigger.reason }}" } } },
  ],
  connections: [
    { source_id: "trigger",      target_id: "read_partner" },
    { source_id: "read_partner", target_id: "is_approved" },
    { source_id: "is_approved",  target_id: "email_ok", connection_type: "success" },
    { source_id: "is_approved",  target_id: "email_no", connection_type: "failure" },
  ],
} as const
```

### Wrap as a Data Plumbing job (registry.ts)

```ts
import { FLOW_DEF as MY_FLOW_DEF } from "../../../../scripts/seed-<name>-flow"

const installMyFlowJob = {
  id: "install-<name>-flow",
  label: "Install <Name> flow",
  description: "Seed the operator-editable <name> visual flow.",
  params: [],
  run: async (container, { dry_run }) => {
    const svc = container.resolve("visual_flows")
    const existing = await svc.listVisualFlows({ name: MY_FLOW_DEF.flow.name })
    if (existing.length) return { /* skip — already installed */ }
    if (dry_run) return { /* report the flow it WOULD create, 0 writes */ }
    await svc.createCompleteFlow(MY_FLOW_DEF)
    return { /* applied: true */ }
  },
}
// …register in the jobs array at the end of registry.ts
```

**Two seed paths, one `FLOW_DEF`:** `npx medusa exec ./src/scripts/seed-<name>-flow.ts`
(shell) OR Admin → Settings → Data Plumbing → "Install <Name> flow" (dry-run → apply,
audited in `ops_maintenance_run`). Both idempotent by flow `name`.
