# CI build-only dispatch — dry-run a branch image against prod

> How to run a backfill or one-off `medusa exec` script from a branch
> against prod RDS **without** deploying the branch to the live
> medusa-server / medusa-worker services. The path uses
> `workflow_dispatch` on the deploy workflow and an `IMAGE_TAG`
> override on `run-backfill.sh`.

---

## When to use this

Whenever you've added a new `src/scripts/foo.ts` and want to verify
its dry-run output against the real prod database before merging.
Examples:

- The 0A region/currency/FX backfill (`PLATFORM_0A_RUNBOOK.md`).
- Any future one-shot migration / data-correction script that lives
  in `apps/backend/src/scripts/`.

The CI flow exists because the prod medusa-server image only rebuilds
on push to `main`. Without this dispatch, the only way to dry-run a
new script in prod is to merge first — which is fine in practice
(scripts are dry-run aware + idempotent), but this dispatch is the
"see real counts before merge" path when you want it.

---

## End-to-end flow

### 1. Push your branch with the new script

```bash
git checkout -b feat/my-backfill
# … add apps/backend/src/scripts/my-backfill.ts …
git push -u origin feat/my-backfill
```

### 2. Manually trigger the deploy workflow (build-only)

GitHub UI: **Actions → Deploy to AWS ECS → Run workflow**.

- **Branch**: pick your feature branch.
- **`deploy_services`**: leave **unchecked** (default `false`).

This builds the image, mirrors it to ECR as `sha-<commit-hash>`, and
**skips** `copilot svc deploy` for both medusa-server and
medusa-worker. The live services keep running whatever they were
running before.

CLI equivalent:

```bash
gh workflow run deploy-to-aws.yml --ref feat/my-backfill \
  -f deploy_services=false
```

### 3. Grab the sha tag from the build summary

The `build-and-push` job's summary tab includes the sha-tag of the
image it just produced. On a build-only dispatch it also prints the
exact `run-backfill.sh` invocation:

```
**Build-only dispatch.** Live services were not redeployed.

To run a backfill against this image:

IMAGE_TAG=sha-<long-commit-hash> DRY_RUN=1 FOLLOW=1 \
  ./deploy/aws/scripts/run-backfill.sh <script-name>
```

### 4. Dry-run against prod RDS using the branch image

```bash
IMAGE_TAG=sha-<long-commit-hash> DRY_RUN=1 FOLLOW=1 \
  ./deploy/aws/scripts/run-backfill.sh my-backfill
```

What this does under the hood:

1. `describe-task-definition` the current `jyt-prod-medusa-server`
   family.
2. Filter it down to the fields `register-task-definition` accepts
   (drops `taskDefinitionArn`, `revision`, `status`,
   `requiresAttributes`, `compatibilities`, `registeredAt`,
   `registeredBy`).
3. Swap the `medusa-server` container's image to your branch's sha
   tag.
4. `register-task-definition` to create a new revision in the same
   family.
5. `run-task` against the new revision with the usual command
   overrides (`pnpm exec medusa exec ./src/scripts/<name>.js`) and
   env overrides (`DRY_RUN`, `BATCH`, `REGION_IDS`, `PARTNER_IDS`,
   `CONCURRENCY`, …).

The new task def revision is harmless — `copilot svc deploy`
references the family by name and re-publishes the manifest's
declared image on the next real deploy, so this side-revision doesn't
pollute the normal deploy path. ECS retains old revisions for free.

### 5. Verify counts, drop DRY_RUN, run for real

Once the dry-run output looks right:

```bash
IMAGE_TAG=sha-<long-commit-hash> FOLLOW=1 \
  ./deploy/aws/scripts/run-backfill.sh my-backfill
```

### 6. Merge

After verifying, merge the branch normally. The push-to-main deploy
will re-publish `:latest` with the merged image, and future
`run-backfill.sh` calls without `IMAGE_TAG` will pick that up.

---

## Why we don't push `:latest` from branches

The `mirror-to-ecr` step in `deploy-to-aws.yml` only tags
`:latest` when `github.ref == refs/heads/main`. The medusa-server and
medusa-worker task definitions both reference `:latest`. If a branch
build moved `:latest` forward, the next ECS task replacement
(autoscale, host drain, deploy, restart) would silently pull the
branch image. The `sha-<commit>` tag is immutable + scoped, so
branch dispatches can only affect what we explicitly point at.

---

## Trade-offs

- **One stale task def revision per dry-run.** Cheap (free), but it
  accumulates. Worth a quarterly housekeeping pass:
  `aws ecs list-task-definitions --family-prefix jyt-prod-medusa-server`
  → deregister the orphans by hand if they pile up.
- **No automatic cleanup of the registered revision on failure.** If
  `run-task` fails, the registered revision remains. Same housekeeping.
- **Not for code changes that need the prod *service* to run them**
  (route changes, subscriber wiring, etc.). This path is one-off
  task-only. Service changes go the normal merge-to-main route.

---

## See also

- `.github/workflows/deploy-to-aws.yml` — the dispatch inputs +
  conditional deploy jobs.
- `deploy/aws/scripts/run-backfill.sh` — the `IMAGE_TAG` flow lives
  here.
- `PLATFORM_0A_RUNBOOK.md` — the first script to use this dispatch
  path end-to-end.
