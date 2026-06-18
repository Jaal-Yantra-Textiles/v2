# Autonomous PR Daemon — Runbook

Self-paced loop that picks up roadmap work, builds it, verifies it with sub-agents,
ships it, and verifies it landed in prod. Designed to survive `/clear`: any fresh
session resumes by reading this file + the GitHub handoff protocol (#352 → active issue).

Authorized by the user (2026-06-15) to run **full-headless**: it may `git push`,
`gh pr merge`, and `aws ssm put-parameter` without prompting. The **verification gate**
(below) is the safety mechanism in place of human approval.

## Per-chunk lifecycle

1. **Resume** — read latest `Session handoff` on #352 → open active issue → read its latest `Handoff` comment.
2. **Pick** — next task from the queue (serial, one issue at a time — single workspace, no worktrees).
3. **Build** — feat branch off `main` in `apps/backend` (backend lives under `apps/backend/`, NOT repo-root `src/`).
4. **Verification gate (BLOCKING — nothing merges unless these pass):**
   - **API:** integration-test agent → `pnpm test:integration:http:shared <path>` (shared DB).
   - **UI (only if admin UI changed):** Playwright agent against local `yarn dev` (must keep dev server up).
5. **Ship** — `gh pr create` → `gh pr merge` to `main` (auto-deploys to prod, ~18 min).
6. **Pace** — `ScheduleWakeup` ~20 min (the deploy window).
7. **Prod-verify** — on wake, confirm the deployed change live, using creds from AWS (account `369351873445`) / prod env.
8. **Handoff** — post `Handoff` comment on the issue, update #352 pointer, then continue to next chunk.

## Work queue (serial)

1. **#485** — Partner UI inventory-orders + design refs show **EUR** instead of store-default currency. Root-cause
   the currency source: money cells render `getStylizedAmount(amount, currency_code)`; trace where the
   inventory-order/design-reference `currency_code` is set to `"eur"` (serializer vs persisted vs default). Likely an
   analysis chunk if it's purely partner-ui (Playwright-gated). [#484 partner search/filters: DONE — PRs #487–#491 merged & verified live on prod 2026-06-18.]
2. **#494** — `execute_code` **isolated-vm sandbox functional + enable-able in prod** (user-flagged: prod flows rely on
   execute_code). Default in-process path works today; the secure isolated path can't be turned on because the runtime
   Docker stage installs `--ignore-scripts` (native addon never built) and `VFLOW_USE_ISOLATED_VM` is unset. Build the
   addon into the prod image + audit flows using external `packages` before flipping. Likely analysis/Docker chunk.
3. **#495** — `POST /partners/customers/:id/customer-groups` **500** (pre-existing, unrelated to #484). Mirror admin pattern.
4. **#403** — extend orders unification to **admin** routes (buildable now; ~3-5 days → multiple chunks/PRs).
5. **#404 P1** — Design Order → Convert to Order → Shiprocket label. **BLOCKED on 3 product decisions:**
   Convert-to-Order paid-vs-COD default? · COD-capture = remittance/P4 confirm · per-entity scope (order-only vs +design+inventory).
   Live-verify also needs a `category: shipping` external-platform record (admin data, not env).
6. Then auto-pick next buildable roadmap issue (#337, #336, #347/#348/#349/#377, …).

> ⚠ **Prod-build watch-out:** the prod Docker `medusa build` is a *full* tsc — it catches errors PR CI (changed-specs
> only) misses. A literal `import("<optionalDep>")` of an `optionalDependencies` native module fails it with TS2307.
> Reference the specifier indirectly. This silently blocked ALL prod deploys from #465 until PR #493 (2026-06-18).

## Creds / prod notes

- Shiprocket creds resolve from the **external-platform store** (`SocialPlatform`, `category: shipping`, encrypted) first;
  `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD` env are fallback only.
  ⚠ latent: resolver reads `SHIPROCKET_PASSWORD` but `apps/backend/.env` defines `SHIPROCKET_API_PASSWORD` (fallback dormant, not the primary path).
- Two Medusa configs: prod runs `medusa-config.prod.ts` (Dockerfile cp-overwrites base) — prod-only wiring goes there.
- One-off prod scripts: ECS run-task off `jyt-prod-medusa-server` task def (ECS Exec disabled). New SSM params need `copilot-application=jyt` + `copilot-environment=prod` tags.
- No auto-merge in repo; every merge to `main` auto-deploys. Leave `apps/storefront-starter` submodule untouched.

## Conventions to honor

- Partner API mirrors admin API wire shape exactly; bug fixes mirror admin's pattern (read `node_modules/@medusajs/medusa/dist/api/admin/...` first), never invent JS-level filter workarounds.
- `query.graph`: `relation.*` suffix (not `*relation` prefix); filters don't auto-join dot-paths.
- Medusa-native styling (`--ui-*`/`--elevation-*`), Skeleton loaders, no critical data in `metadata`.
