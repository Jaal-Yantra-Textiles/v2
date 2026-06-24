# #457 Data Plumbing — Seed-script inventory (expose / defer / exclude)

Maps every `apps/backend/src/scripts/seed-*.ts` to whether its logic should be
reachable from **Settings → Data Plumbing** (the #457 maintenance-jobs
registry). Follows the memory rule *"backfills/repairs/seeds must be #457
registry jobs, not one-off scripts"* (`feedback_backfills_via_data_plumbing`).

**Hard rule for any exposed job:** idempotent + **dry-run-safe** (a dry run
writes nothing and reports what *would* change).

This PR ships the **email-template** slice only — the urgent need for an empty
admin — plus the reusable pattern (`seed-jobs.ts`) the rest slot into.

## Status legend
- **EXPOSE (this PR)** — wrapped by the `seed-email-templates` maintenance job.
- **DEFER** — safe + idempotent + useful, but needs per-seed preview logic
  (different exists/create shape). Next follow-up. The pattern is established.
- **EXCLUDE** — must NOT be exposed (env/prod-snapshot/test/fixture, or already
  has a dedicated job).

## Email templates → EXPOSE (this PR)
The `seed-email-templates` job wraps these via the `set` param
(`core | additional | reengagement | partner | cart-abandoned | tour | visual-flow-lifecycle | all`).
All already idempotent (skip-existing by `template_key`); the job dedupes keys
across sets and only creates missing ones.

| Seed script | `set` key | Notes |
|---|---|---|
| `seed-email-templates.ts` | `core` | ~40 base templates (order/design/partner/etc.) |
| `seed-additional-email-templates.ts` | `additional` | partner-welcome, order-feedback-request, payment-receipt (#450) |
| `seed-reengagement-email-templates.ts` | `reengagement` | win-back, back-in-stock, browse-abandonment, feedback-reminder (#450) |
| `seed-partner-email-templates.ts` | `partner` | partner run completed/cancelled, region-request-admin, storefront-digest |
| `seed-cart-abandoned-email.ts` | `cart-abandoned` | single `cart-abandoned` template (overlaps `core`; deduped) |
| `seed-tour-email-template.ts` | `tour` | `tour-itinerary-confirmation` |
| `seed-visual-flow-lifecycle-email-templates.ts` | `visual-flow-lifecycle` | `visual-flow-started`, `visual-flow-failure` |

> Each of these now `export`s its template data (array/const) so `seed-jobs.ts`
> imports the canonical content — single source of truth, no duplication.

## Reference data → DEFER (next follow-up)
Idempotent + generally useful, but each has bespoke exists/create logic, so the
dry-run preview can't be reused from the email pattern as-is.

| Seed script | Idempotency | Why deferred |
|---|---|---|
| `seed-energy-rates.ts` | skip by `name` | clean — easiest next; needs a `name`-keyed planner |
| `seed-partner-plans.ts` | skip by `slug` | clean — second easiest; `slug`-keyed planner |
| `seed-canonical-tax-regions.ts` | skip by root country | multi-step tax writes; money-sensitive — preview carefully |
| `seed-in-textile-tax-class.ts` | skip by type/rate | multi-step (product_type + tax_region + tax_rate); money-sensitive |
| `seed-initial-fx-rates.ts` | **upsert** (mutates) | not skip-existing — re-run UPDATES rows; make skip-only before exposing |
| `seed-stats-dashboards.ts` | skip-existing | reference dashboards; verify dry-run shape |
| `seed-tour-form-fields.ts` | skip-existing | reference form fields |
| `seed-marketing-forms.ts` | skip-existing | reference forms |

## Excluded → do NOT expose
| Seed script | Reason |
|---|---|
| `seed-website-from-prod.ts` | prod snapshot import — not reference data |
| `seed-partner-notification-test.ts` | test/dev fixture |
| `seed-florence-tour.ts` | demo/fixture content |
| `seed-partner-page-fixtures.ts` | fixture |
| `seed-design-cart-links.ts` | fixture/link wiring |
| `seed-plans.ts` | reads the filesystem (`fs.existsSync(plansPath)`) — unreliable in the API bundle; promote only if rewritten to inline data |
| `seed-cart-recovery-dashboard.ts` | dashboard fixture (pairs with the flow) |
| `seed-marketing-ideas-email.ts` | already has dedicated jobs (`run-marketing-ideas-email`, `install-marketing-ideas-email-flow`) |
| **Visual-flow seeds** — `seed-cart-recovery-flow`, `seed-fx-refresh-flow`, `seed-fx-rerate-flow`, `seed-marketing-daily-ideas-email-flow`, `seed-order-upsert-flow`, `seed-partner-analytics-digest-flow`, `seed-partner-payment-status-flow`, `seed-partner-product-create-flow`, `seed-partner-run-whatsapp-flow`, `seed-production-run-reminders-flow`, `seed-production-run-whatsapp-flow` | visual flows install via dedicated `install-*-flow` jobs / the visual-flows console, not the seed registry |

## Pattern (for the follow-up)
`src/api/admin/ops/maintenance-jobs/seed-jobs.ts`:
- `EMAIL_TEMPLATE_SETS` — set key → label + spec list (imported from each seed).
- `resolveEmailTemplateSpecs(set)` — pure: set → deduped spec list.
- `planEmailTemplateSeed(specs, existingKeys)` — pure: partition create-vs-skip.
- `buildEmailTemplateSeedResult(...)` — pure: plan → `MaintenanceJobResult`.
- `seedEmailTemplatesJob.run` — list existing `template_key`s once, plan, then
  on apply `createEmailTemplates` only the missing ones.

To add the reference-data seeds: generalise the planner to a
`(spec) => naturalKey` extractor + a `(container, spec) => create` callback, then
register one job per seed (energy-rates and partner-plans first — both are clean
single-key skip-existing).
