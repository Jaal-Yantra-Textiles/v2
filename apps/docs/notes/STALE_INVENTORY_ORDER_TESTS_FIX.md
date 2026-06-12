# Stale inventory-order test fixes (3 tests, fail on main)

*Written 2026-06-12 during #342 T2 (PR #387) validation. Next session: read
THIS file; do not rely on chat history. This is a test-only cleanup PR — no
product code should change.*

**State:** 3 integration tests fail on a clean main (baseline verified at
`03a4537cf`). All three are stale tests asserting contracts that were
intentionally changed months ago — they are NOT regressions and NOT flaky.
Diagnosis below is exact (instrumented + traced to source); fix = update the
tests to the current contracts.

**Run them:**

```bash
cd apps/backend
pnpm test:integration:http:shared ./integration-tests/http/inventory-orders-api.spec.ts ./integration-tests/http/send-to-partner-error-cases.spec.ts
```

---

## 1. `inventory-orders-api.spec.ts` › "should not update an order if status is not Pending"

- **Symptom:** expects 400, gets 200.
- **Root cause:** the test asserts the OLD rule ("only Pending is updatable").
  The guard in
  `src/workflows/inventory_orders/update-inventory-orders.ts` (~line 38,
  `fetchOriginalOrderStep`) was deliberately widened around 2026-03-08/12
  (payment-reporting era) to:
  `if (!["Pending", "Processing"].includes(originalOrder.status))` with
  message `"Order can only be updated if status is 'Pending' or 'Processing'."`
- **Fix (test):**
  1. The existing test's first half (update to `Processing`, then update
     again) should now ASSERT 200 — rename it accordingly ("should update an
     order while Processing").
  2. Add the negative case the suite actually wants: drive the order to a
     non-updatable status (PUT `{ status: "Shipped" }` is allowed while
     Processing, per the same guard), then a further update must 400 with the
     NEW message `"Order can only be updated if status is 'Pending' or
     'Processing'."`

## 2. `send-to-partner-error-cases.spec.ts` › "should fail to complete non-existent order"

- **Symptom:** expects 404 `"InventoryOrders with id: non-existent-id was not
  found"`, gets 400.
- **Root cause:** the test body is `{ notes }` only. The route
  (`src/api/partners/inventory-orders/[orderId]/complete/route.ts`) gained a
  Zod schema requiring `lines: z.array(...).nonempty()`, and body validation
  runs BEFORE any existence check → 400 `"Invalid request body"` regardless of
  order id.
- **Fix (test):** send a schema-valid body, e.g.
  `{ notes, lines: [{ order_line_id: "fake-line", quantity: 1 }] }`.
  Then the workflow's own existence check fires:
  `partner-complete-inventory-order.ts` ~line 243 throws
  `MedusaError NOT_FOUND` → HTTP 404 with message
  **`Inventory order non-existent-id not found`** (note: NOT the old
  retrieve-style `"InventoryOrders with id: ... was not found"` — update the
  assertion to the new message).

## 3. `send-to-partner-error-cases.spec.ts` › "should fail to complete unassigned order"

- **Symptom:** unhandled `AxiosError 400` — the test dies in FIXTURE setup,
  never reaching the assertion.
- **Root cause (instrumented, exact body):** the unwrapped fixture call
  `POST /admin/inventory-orders` returns
  `{"message":"Invalid request: Unrecognized fields: 'inventory_item_id'"}`.
  The payload has a stray TOP-LEVEL `inventory_item_id` (it belongs only
  inside `order_lines[]`) and admin create validation rejects unknown fields.
- **Fix (test):**
  1. Delete the stray top-level `inventory_item_id` from
     `separateOrderPayload`.
  2. The complete body also needs `lines` (same schema as #2) or it will 400
     on validation instead of the intended check.
  3. Update the assertion: the workflow now throws `NOT_ALLOWED` (→ 400) with
     message **`Inventory order ${id} not in an updatable state (status:
     Pending)`** (`partner-complete-inventory-order.ts` ~line 250) — not the
     old `"... is not in Processing state"`. (If the order somehow passed the
     status gate, the next gate is `"... is not in started state"` on
     `metadata.partner_status` — irrelevant here since the fixture order stays
     `Pending`.)

---

## Gotchas / conventions for the fixing session

- Assert ACTUAL current behavior; if a message doesn't match exactly, trust
  the source files cited above over this doc and re-run to confirm. Do not
  change product code to make old assertions pass — the contract changes were
  intentional (mirror-admin convention: never invent JS-level workarounds).
- Shared suite truncates DB per test — fixtures are per-test, keep it that way.
- `pnpm test:integration:http:shared <paths>` from `apps/backend` (NOT repo
  root paths); `--testNamePattern` works after `--`.
- These suites also exercise the #342 dual-write shim incidentally (create →
  projection step). The shim is best-effort and must stay invisible to these
  tests — if a fix suddenly surfaces `[orders-unification]` warnings, that's
  log noise, not a failure.
- When done: delete this file in the same PR (it's a handoff note, not living
  documentation).
