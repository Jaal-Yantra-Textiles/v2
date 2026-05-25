# PR #259 + #261 Production Deploy Runbook

> Status: **READY TO RUN** once the image is built and deployed.
> Date: 2026-05-25
> Owner: Saransh
> Migrations: 2 backfills + 1 seed, all idempotent + dry-run-safe.

## What's about to land in prod

| Commit set | What it does | Compatible with current prod? |
|---|---|---|
| Partner region admin-parity + safety (PR #259) | Drops `store.default_region_id` fallback in partner GET, ref-counted DELETE, clone-on-write, auto-expand currencies | **Requires backfill** — see Migration 1 below |
| Partner-UI hooks fix (PR #259) | Hooks now actually send `query` params to URL | Drop-in, no migration needed |
| Tax-region admin-mirror (PR #259) | Reuses admin's validators + middleware | No migration |
| Banner above partner regions list (PR #259) | UI-only, dismissible alert | No migration |
| Canonical tax-region seed (PR #261) | Fills tax_regions for every admin region's countries | **Requires seed** — see Migration 3 below |

## Pre-flight checks

```bash
# 1. Confirm main is at the expected commit (PR #259 + #261 merged)
git fetch origin main
git log origin/main --oneline | head -5
#   c803a4963 Merge pull request #261 ... canonical-tax-regions-seed
#   398aa8d04 Merge pull request #259 ... partner-regions-admin-parity

# 2. Confirm prod state via admin API (read-only sanity check)
#    Use a fresh API key, not the one shared in a transcript
PROD=https://v3.jaalyantra.com
KEY=<your-rotated-admin-api-key>
BASIC=$(printf "%s:" "$KEY" | base64)

# Region count + names — should match what's seeded today
curl -sS -H "Authorization: Basic $BASIC" "$PROD/admin/regions?limit=100" \
  | jq '{count, regions: [.regions[] | {id, name, currency_code, countries: [.countries[].iso_2]}]}'

# Current tax-region count (expect 1 — India only)
curl -sS -H "Authorization: Basic $BASIC" "$PROD/admin/tax-regions?limit=100" \
  | jq '{count, by_country: [.tax_regions[] | .country_code]}'

# Partner count (expect 21 as of 2026-05-25)
curl -sS -H "Authorization: Basic $BASIC" "$PROD/admin/partners?limit=1" | jq '.count'
```

## Step 1 — Build + deploy the new image to STAGING

CI builds the image automatically on merge to main. Wait for the green check on `398aa8d04` (the PR #259 merge commit).

```bash
# Deploy to staging via Copilot
cd deploy/aws
copilot svc deploy --name medusa-server --env staging
```

This is a blue/green deploy — the old task keeps serving traffic until the new one passes ALB health checks (240s grace per `reference_aws_ecs_medusa_gotchas`).

## Step 2 — Migration 1: backfill `partner_region` links (STAGING then PROD)

**Why:** PR #259 drops the `store.default_region_id` fallback in partner GET handlers. Pre-PR-A partners whose store has a `default_region_id` but no explicit `partner_region` link row will see an empty region list. This script creates the missing links.

**Idempotent:** re-runs only create what's missing.

```bash
cd deploy/aws

# STAGING — dry run first
DRY_RUN=1 FOLLOW=1 \
  ECS_CLUSTER=jyt-staging-Cluster-XXX \
  TASK_FAMILY=jyt-staging-medusa-server \
  LOG_GROUP=/copilot/jyt-staging-medusa-server \
  ./scripts/run-backfill.sh backfill-partner-region-links

# Eyeball the log output:
#   ✓ Look for "WOULD link partner ... → region ..." lines
#   ✓ Confirm count looks reasonable (matches your number of legacy partners)
#   ✓ Final line: "Backfill complete. created=N, already_linked=M, ... errors=0"

# STAGING — real run (drop DRY_RUN)
FOLLOW=1 \
  ECS_CLUSTER=jyt-staging-Cluster-XXX \
  TASK_FAMILY=jyt-staging-medusa-server \
  LOG_GROUP=/copilot/jyt-staging-medusa-server \
  ./scripts/run-backfill.sh backfill-partner-region-links

# STAGING — smoke test
#   Open partner UI, log in as a test partner, confirm region list is populated
#   (was empty before the backfill if the partner relied on default_region_id)

# PROD — same sequence
DRY_RUN=1 FOLLOW=1 ./scripts/run-backfill.sh backfill-partner-region-links
FOLLOW=1 ./scripts/run-backfill.sh backfill-partner-region-links
```

The script sets `process.exitCode = 1` on per-link errors. If you see errors, the ECS task exits non-zero — review the log before proceeding.

## Step 3 — Migration 2: backfill `store.supported_currencies` from linked regions

**Why:** PR #259 auto-expands supported_currencies when a partner creates/updates a region. Existing partners whose regions use currencies not in their `supported_currencies` will see disabled pricing columns in the partner UI pricing grid.

**Idempotent.** Uses `updateStoresWorkflow` (direct service call silently no-ops on `supported_currencies` — see commit `10608c6` for the why).

```bash
# STAGING — dry run
DRY_RUN=1 FOLLOW=1 \
  ECS_CLUSTER=jyt-staging-Cluster-XXX \
  TASK_FAMILY=jyt-staging-medusa-server \
  LOG_GROUP=/copilot/jyt-staging-medusa-server \
  ./scripts/run-backfill.sh backfill-store-currencies-from-partner-regions

# Look for: "WOULD add currencies [zar, ...] to supported_currencies" lines

# STAGING — real
FOLLOW=1 \
  ECS_CLUSTER=jyt-staging-Cluster-XXX \
  TASK_FAMILY=jyt-staging-medusa-server \
  LOG_GROUP=/copilot/jyt-staging-medusa-server \
  ./scripts/run-backfill.sh backfill-store-currencies-from-partner-regions

# PROD — same sequence
DRY_RUN=1 FOLLOW=1 ./scripts/run-backfill.sh backfill-store-currencies-from-partner-regions
FOLLOW=1 ./scripts/run-backfill.sh backfill-store-currencies-from-partner-regions
```

## Step 4 — Migration 3: seed canonical tax_regions

**Why:** Prod currently has tax_regions only for India. Partners with EU/AU/Indonesia customers can't compute tax at checkout. This script ensures every admin region's countries have a tax_region with the statutory standard rate.

**Idempotent.** Skips countries that already have a root tax_region. US deliberately skipped (no federal sales tax).

```bash
# STAGING — dry run
DRY_RUN=1 FOLLOW=1 \
  ECS_CLUSTER=jyt-staging-Cluster-XXX \
  TASK_FAMILY=jyt-staging-medusa-server \
  LOG_GROUP=/copilot/jyt-staging-medusa-server \
  ./scripts/run-backfill.sh seed-canonical-tax-regions

# Look for: "WOULD create tax_region for AU: 10% (Australia GST)" lines

# STAGING — real
FOLLOW=1 ./scripts/run-backfill.sh seed-canonical-tax-regions

# STAGING — smoke
#   Place a test order from an EU IP / region, confirm tax computes at checkout

# PROD — same sequence
DRY_RUN=1 FOLLOW=1 ./scripts/run-backfill.sh seed-canonical-tax-regions
FOLLOW=1 ./scripts/run-backfill.sh seed-canonical-tax-regions
```

## Step 5 — Verify in PROD

```bash
PROD=https://v3.jaalyantra.com
KEY=<your-admin-key>
BASIC=$(printf "%s:" "$KEY" | base64)

# Tax-region count should now be ~36 (every country in the 5 admin regions
# except US, which we skipped). India should still be 1 (existing), the
# others new.
curl -sS -H "Authorization: Basic $BASIC" "$PROD/admin/tax-regions?limit=100" \
  | jq '{count, by_country: [.tax_regions[] | .country_code] | sort | unique}'

# Pick 2-3 real partners and check their store supported_currencies now
# covers their linked region currencies (use partner login flow or
# admin-side query)
```

## Rollback plan

The migrations are additive — they create new link rows and tax_region rows. **There's no destructive path**. If something goes wrong:

- **Bad data in a backfill:** the rows are easy to identify (recent created_at, our specific tax rate codes, etc.) and can be deleted via admin API
- **Image regression:** Copilot's blue/green keeps the previous task definition. Re-deploy the prior `copilot svc deploy --resource-tags BuildSHA=<old-sha>`, or roll back the ECS service via console

## Operational gotchas

- **240s ALB grace period** — every new ECS task takes ~3-4 min to be ready after `Server is ready on port: 9000`. Wait for ALB health before declaring "deployed."
- **One-shot tasks share the same task definition** — the backfill scripts inherit SSM secrets, VPC, IAM role from the medusa-server task. No separate setup.
- **`pg_stat_activity` is your friend** — if a backfill seems stuck, the long-running query will show up there. RDS is in private subnets; query via the bastion or a one-off Fargate task with psql.

## Total runtime estimate

- Migration 1: ~30-60s (21 partners, 5 regions each — fast)
- Migration 2: ~30-60s (same scale)
- Migration 3: ~2-3 min (36 countries × createTaxRegionsWorkflow each)
- Plus image deploy: ~5 min
- Plus smoke testing: ~10-15 min

Plan on ~30-45 min wall clock for the full sequence including smoke. Budget an hour to be safe.
