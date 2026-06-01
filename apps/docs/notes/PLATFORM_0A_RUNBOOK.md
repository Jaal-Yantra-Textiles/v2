# Platform 0A — Region + currency + FX backfill runbook

> Operator runbook for the one-shot unblock described in
> `PLATFORM_ROADMAP_2026_05.md` item #0A. Goal: every active partner
> store stops showing "we don't ship to AU/EU/US/ID" to visitors from
> those regions.
>
> This is the manual path. The structural fix (`region.created`
> subscriber + admin "share to all" button) is roadmap #0B — see the
> roadmap for sequencing.

---

## What this does

Three additive, idempotent passes:

1. **Link** every partner to every admin region (`partner_region`).
2. **Extend** each partner store's `supported_currencies` to cover the
   newly-linked regions' currencies.
3. **Fan out** existing variant prices through the FX workflow so
   converted price rows materialize for the new currencies.

Each step is safe to re-run — they all skip rows that already match
the intended state.

---

## Acceptance check

After running all three, on a live partner storefront (Ielo or GOF are
the canaries):

- `curl https://<partner-storefront>/api/regions` (or whatever the
  storefront-starter equivalent is) returns AU/EU/US/ID alongside IN.
- A product detail page shows a price in the visitor's currency when
  the visitor is in AU/EU/US/ID. No "we don't ship here" fallback.
- Admin → Partners → Regions tab shows the partner linked to all 5
  admin regions.

---

## Local / dev run

Each script supports `--dry-run` (or `DRY_RUN=1`) and prints what
would happen without writing anything. Always start there.

```bash
cd apps/backend

# Step 1 — preview the partner × region cross-product
DRY_RUN=1 npx medusa exec ./src/scripts/backfill-all-admin-regions-to-partners.ts

# Step 2 — preview the currency extension
DRY_RUN=1 npx medusa exec ./src/scripts/backfill-store-currencies-from-partner-regions.ts

# Step 3 — preview the fanout invocations
DRY_RUN=1 npx medusa exec ./src/scripts/fanout-existing-variant-prices.ts
```

If the dry-run counts look right, drop `DRY_RUN=1` and re-run each in
the same order.

### Scoping flags

Both scripts that touch partners/regions take optional scope:

- `--region-ids=reg_a,reg_b` (or `REGION_IDS=…`) — limit step 1 to a
  subset of admin regions. Useful if there's a test/sandbox region in
  the DB you don't want to expose to partners.
- `--partner-ids=par_a,par_b` (or `PARTNER_IDS=…`) — limit any step to
  a subset of partners. Useful for a canary on one partner before the
  full sweep.
- `CONCURRENCY=N` on step 3 — caps parallel fanout invocations
  (default 4). Bump for big tenants if the fanout is slow.

---

## Dry-run from this branch (before merging)

The scripts must be inside the medusa-server image for the one-off
Fargate task to find them. Push to `main` does this automatically,
but you can also dry-run **before** merging via the build-only
`workflow_dispatch` path — see
[`CI_BUILD_ONLY_DISPATCH.md`](./CI_BUILD_ONLY_DISPATCH.md).

Short version:

1. **Actions → Deploy to AWS ECS → Run workflow** on this branch with
   `deploy_services` **unchecked**.
2. Grab the `sha-<commit>` tag from the build summary.
3. Run each step with `IMAGE_TAG=sha-<commit> DRY_RUN=1`:

```bash
IMAGE_TAG=sha-xxx DRY_RUN=1 FOLLOW=1 \
  ./deploy/aws/scripts/run-backfill.sh backfill-all-admin-regions-to-partners

IMAGE_TAG=sha-xxx DRY_RUN=1 FOLLOW=1 \
  ./deploy/aws/scripts/run-backfill.sh backfill-store-currencies-from-partner-regions

IMAGE_TAG=sha-xxx DRY_RUN=1 FOLLOW=1 \
  ./deploy/aws/scripts/run-backfill.sh fanout-existing-variant-prices
```

If counts look right, either drop `DRY_RUN=1` and run for real on the
branch image, or merge first and use the normal prod-run flow below.

---

## Prod run

The helper at `deploy/aws/scripts/run-backfill.sh` launches a one-off
Fargate task reusing the medusa-server task definition (inherits RDS
secrets + IAM + VPC). It passes `DRY_RUN`, `REGION_IDS`,
`PARTNER_IDS`, and `CONCURRENCY` through to the container.

```bash
# Step 1 — dry-run first
DRY_RUN=1 FOLLOW=1 ./deploy/aws/scripts/run-backfill.sh \
  backfill-all-admin-regions-to-partners

# Step 1 — real run (no DRY_RUN)
FOLLOW=1 ./deploy/aws/scripts/run-backfill.sh \
  backfill-all-admin-regions-to-partners

# Step 2 — dry-run then real
DRY_RUN=1 FOLLOW=1 ./deploy/aws/scripts/run-backfill.sh \
  backfill-store-currencies-from-partner-regions
FOLLOW=1 ./deploy/aws/scripts/run-backfill.sh \
  backfill-store-currencies-from-partner-regions

# Step 3 — dry-run then real
DRY_RUN=1 FOLLOW=1 ./deploy/aws/scripts/run-backfill.sh \
  fanout-existing-variant-prices
FOLLOW=1 ./deploy/aws/scripts/run-backfill.sh \
  fanout-existing-variant-prices
```

`FOLLOW=1` tails CloudWatch until the task exits — recommended so you
catch the per-step summary line at the end of each run.

### Canary first

Recommended: run step 1 + 2 + 3 against a single partner before the
full sweep, to confirm the storefront actually picks up the change.

```bash
# Pick a low-traffic partner, e.g. internal test partner
PARTNER_IDS=par_xxx FOLLOW=1 \
  ./deploy/aws/scripts/run-backfill.sh backfill-all-admin-regions-to-partners

PARTNER_IDS=par_xxx FOLLOW=1 \
  ./deploy/aws/scripts/run-backfill.sh backfill-store-currencies-from-partner-regions

PARTNER_IDS=par_xxx FOLLOW=1 \
  ./deploy/aws/scripts/run-backfill.sh fanout-existing-variant-prices
```

Verify on that partner's storefront, then re-run without `PARTNER_IDS`
to sweep everyone.

---

## Expected output shape

Each script ends with a summary line. Roughly:

```
Backfill complete. created=42, already_linked=7, partners=14, regions=5, errors=0
Backfill complete. stores_updated=14, stores_already_current=0, …
Fanout complete. created_prices=1200, skipped_auto=300, skipped_other=0, errors=0
```

`errors > 0` exits with code 1 so the Fargate task surfaces a
non-success status — review the log above the summary, fix, re-run.

---

## Cleanup / rollback

These are additive. Nothing is deleted. Rollback if needed:

- **Step 1** — delete the link rows you just created. They're in the
  `partner_region` link table; the script logs every `partner → region`
  pair it added.
- **Step 2** — `supported_currencies` is a managed relation on
  `store`; remove via `updateStoresWorkflow` with the original list.
- **Step 3** — auto-converted prices are tagged via `fx_price_meta`.
  Drop them by deleting matching `price` rows + their `fx_price_meta`
  link rows. The price IDs created are in the CloudWatch log.

In practice, "did too many partners get the new regions" is not the
failure mode we expect — the failure mode is "didn't propagate at
all", which is what we're fixing here.

---

## See also

- `PLATFORM_ROADMAP_2026_05.md` — item #0A (the blocker), #0B (the
  structural fix that supersedes this runbook).
- `FX_AUTO_CONVERSION.md` — design of the FX workflow that step 3
  drives.
- `feedback_focused_regions_fx_conversion.md` — why we run one
  manually-priced source currency per product and fan out via FX
  rather than per-currency manual entry.
