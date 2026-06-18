# Ops Data-Plumbing — How-To (admin maintenance jobs)

**Audience:** operators/admins running guarded data corrections.
**Status:** backend live (#457 registry). Admin Ops-console UI is still pending
(Playwright-gated — see "UI" below).

---

## What it is

A registry of **guarded, dry-run-by-default** data-correction jobs exposed under
`/admin/ops/maintenance-jobs`. Each job follows the same safe contract:

- **dry-run (default)** → returns the changes it *would* make, **writes nothing**.
- **apply** (`dry_run: false`) → idempotent write; returns the changes made.
- every run is persisted to the durable **audit log** (`GET .../runs`).

Jobs surface + guard-rail one-off scripts so the recurring "the code fix stops
recurrence but stored rows still need a targeted, safe correction" incident no
longer needs raw `curl` / ad-hoc ECS run-task scripts.

## API

```
GET  /admin/ops/maintenance-jobs                 # list jobs + their params
POST /admin/ops/maintenance-jobs/:id/run         # run a job (dry-run by default)
GET  /admin/ops/maintenance-jobs/runs            # audit-log history (filter job_id, dry_run, applied)
```

Auth: admin (same headers as any `/admin/*` route). Prod: see
`reference_prod_verify_access` (Basic auth, `v3.jaalyantra.com`).

### Run payload

```jsonc
{
  "dry_run": true,                 // default true; set false to APPLY
  "params": { /* job-specific */ } // see GET list for each job's params
}
```

### The golden workflow (ALWAYS)

1. **List** → `GET /admin/ops/maintenance-jobs`, read the target job's `params`.
2. **Dry-run** → `POST :id/run` with `dry_run: true` (or omit — it defaults true).
   Inspect `result.changes` (every `before → after`) and `result.summary`.
3. **Apply** → re-`POST` with `dry_run: false` **only after** the dry-run preview
   looks right. Re-running is idempotent (a no-op once corrected).
4. **Audit** → `GET .../runs?job_id=<id>` to confirm the persisted record.

> Start narrow: most jobs accept a single-entity id (`design_id`,
> `production_run_id`, `partner_id`) — correct ONE row, verify, then sweep.

## Registered jobs

| id | what it corrects |
|---|---|
| `recalculate-design-cost` / `-bulk` | design cost_breakdown vs fresh estimate |
| `correct-production-run-cost` | per-unit × qty = total run cost |
| `backfill-inventory-unit-cost` | raw_material.unit_cost from latest order line |
| `backfill-design-energy-costs` | design energy/labor cost buckets |
| `prune-ops-audit-runs` | retention/pruning of the audit log itself |
| `backfill-partner-order-currency` | partner work-order `currency_code` (#485) |

## Example — fix partner order currency (#485)

On a multi-store deployment the old `stores[0]` pattern stamped the **platform**
store currency (EUR) onto partner work-orders instead of the partner's own store
currency (INR). The new code path (`resolveStoreCurrency`) prevents recurrence;
the backfill job re-labels already-stamped rows.

> This is a **relabel, not an FX conversion** — the amounts were entered in the
> partner's native currency all along; only the `currency_code` column was wrong.

```bash
# 1. Dry-run for ONE partner (preview only)
curl -X POST .../admin/ops/maintenance-jobs/backfill-partner-order-currency/run \
  -H "$ADMIN_AUTH" -H 'Content-Type: application/json' \
  -d '{ "dry_run": true, "params": { "partner_id": "partner_123" } }'
# → result.changes: [{ entity:"order", field:"currency_code", before:"eur", after:"inr" }, ...]

# 2. Apply for that partner
curl -X POST .../admin/ops/maintenance-jobs/backfill-partner-order-currency/run \
  -H "$ADMIN_AUTH" -H 'Content-Type: application/json' \
  -d '{ "dry_run": false, "params": { "partner_id": "partner_123" } }'

# 3. Sweep all partners (bounded by limit; chunk with limit + repeat)
curl -X POST .../admin/ops/maintenance-jobs/backfill-partner-order-currency/run \
  -H "$ADMIN_AUTH" -H 'Content-Type: application/json' \
  -d '{ "dry_run": false, "params": { "limit": 1000 } }'
```

Params: `partner_id?` (scope to one partner), `from_currency?` (default `"eur"` —
only re-stamps orders currently in this currency), `limit?` (default 1000, max
5000 changes/call). A partner whose own store currency equals `from_currency` is
skipped. Resolution uses `resolveStoreCurrency(container, { partnerId })`
(`apps/backend/src/lib/resolve-store-currency.ts`).

## Adding a new job (for engineers)

Mirror an existing job in `apps/backend/src/api/admin/ops/maintenance-jobs/registry.ts`:

1. A **pure** diff helper (`diffXxx`) + **pure** summary builder (`summarizeXxx`)
   — exported so the dry-run/apply selection is unit-testable without the DB.
2. A zod `params` schema with sane caps (`MAX_*_SCAN`), parsed in `run`; throw
   `MedusaError.Types.INVALID_DATA` on a bad param (→ 400).
3. The `MaintenanceJob` object (`id`, `label`, `description`, `params[]`, `run`);
   append it to `MAINTENANCE_JOBS`.
4. Tests: pure-helper unit specs in `__tests__/registry.unit.spec.ts`
   (`TEST_TYPE=unit`); a GET-lists + dry-run-safe + invalid-param-400 trio in
   `integration-tests/http/ops-maintenance-jobs.spec.ts` (run per-file).

The `:id/run` route persists an audit row best-effort (`buildAuditRow`) — no
extra wiring needed.

## UI (pending)

A Settings-route admin console to list jobs, run dry-run→apply with a change
preview, and browse `GET .../runs` history is **not built yet**. It's
Playwright-gated (must be driven against a live `yarn dev` + screenshot, not
unit-tested). Until then, drive the jobs via the API above. Mirror the admin
dashboard patterns in `medusa-dev:building-admin-dashboard-customizations`.
