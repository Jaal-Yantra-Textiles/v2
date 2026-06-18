# #494 — Make `execute_code` isolated-vm sandbox enable-able in prod — ROOT CAUSE + verified fix

> Status: **ANALYSIS (no code shipped).** Blocked on one infra decision (prod-wide
> Node 20 → 22 base-image bump) + a prod data audit. Fix path is empirically
> verified with throwaway Docker runs (below). Daemon chunk 2/6, 2026-06-18.

## TL;DR

The secure `execute_code` sandbox (`VFLOW_USE_ISOLATED_VM`, from #459/#465) cannot
be turned on in prod because **`isolated-vm@6.1.2` requires Node ≥ 22**, but the
prod image is **`node:20-slim`**. The native addon simply cannot load on Node 20 —
no amount of build-tool wrangling fixes it. The issue's stated cause
(`--ignore-scripts` skips node-gyp) is **outdated**: v6 ships prebuilt binaries
(prebuildify / node-gyp-build), so it needs **no** compilation at install — but it
ships **no Node-20 (ABI 115) prebuild**, and source-building v6 on Node 20 is
unsupported.

There are **three independent layers**, all of which must be addressed:

| # | Layer | Effect | Fix |
|---|-------|--------|-----|
| 1 | **Node version mismatch** (primary, newly found) | isolated-vm@6.1.2 `engines.node` = `>=22.0.0`; prebuilds only for ABI 127 (Node 22) & 137 (Node 24). Prod = `node:20-slim` (ABI 115). Binary can't load; source-build unsupported on Node 20. | Bump builder + runtime base image to `node:22-slim`. |
| 2 | **`medusa build` drops `optionalDependencies`** | The generated `.medusa/server/package.json` omits optionalDependencies, so `isolated-vm` is **never installed** into the runtime `node_modules` at all — independent of `--ignore-scripts`. | Move `isolated-vm` from `optionalDependencies` → `dependencies` in `apps/backend/package.json` (or copy the built package from the builder stage). |
| 3 | **`VFLOW_USE_ISOLATED_VM` unset** | Flag defaults OFF, so even a loadable addon stays dormant. | Set in prod SSM **only after** the packages audit (below) clears. |

> Note layer 2 also means the current `Dockerfile` `--ignore-scripts` concern from
> the issue is a non-issue for v6: prebuildify places the binary in the package
> tarball under `prebuilds/`, resolved at **require** time by `node-gyp-build` — no
> postinstall script runs. So once the package is present on a Node-22 image,
> `pnpm install --prod --ignore-scripts` is fine; no build tools needed.

## Evidence

### isolated-vm@6.1.2 metadata (local `node_modules`)
```
engines: {"node":">=22.0.0"}
prebuilds/linux-x64/: isolated-vm.abi127.glibc.node  isolated-vm.abi127.musl.node
                      isolated-vm.abi137.glibc.node  isolated-vm.abi137.musl.node
```
ABI map: Node 20 = 115, Node 22 = **127**, Node 24 = **137**. There is **no abi115**
prebuild → nothing to load on Node 20.

### `.medusa/server/package.json` (output of `medusa build`)
`dependencies` includes `lodash`/`dayjs`/`validator` (regular deps, bridged into the
sandbox) but **not** `isolated-vm` — confirming `medusa build` strips
`optionalDependencies`.

### Throwaway Docker verification (no repo files touched)
```
# node:22-slim — zero build tools, fresh npm i isolated-vm@6.1.2
$ docker run --rm node:22-slim bash -lc 'mkdir -p /app && cd /app \
    && npm init -y && npm i isolated-vm@6.1.2 \
    && node -e "...new ivm.Isolate(); ctx.eval(40+2)..."'
v22.22.3
ISOLATED_VM_OK result= 42          # ✅ loads + runs, no python3/build-essential

# node:20-slim — same command
v20.20.2
LOAD_FAIL: Cannot find module 'isolated-vm'
npm error gyp ERR! node -v v20.20.2   # ⛔ no prebuild → node-gyp source build → fails
npm error gyp ERR! not ok
```
So the fix (Node 22 base image + isolated-vm present) is proven to work, and the
root cause (Node 20) is proven to break.

## Proposed fix (for human review — NOT shipped here)

This is high blast radius: the base image is shared by **every** prod deploy and
**auto-deploys on merge**. It must be a deliberate, separately-verified PR.

1. **`apps/backend/Dockerfile`** — both stages:
   ```diff
   -FROM node:20-slim AS builder
   +FROM node:22-slim AS builder
   ...
   -FROM node:20-slim AS runtime
   +FROM node:22-slim AS runtime
   ```
2. **`apps/backend/package.json`** — move the dep so `medusa build` carries it:
   ```diff
   -  "optionalDependencies": {
   -    "isolated-vm": "^6.1.2"
   -  },
   +  // into "dependencies":
   +  "isolated-vm": "^6.1.2",
   ```
   (Alternative if you want to keep it optional: `COPY --from=builder` the built
   `isolated-vm` package dir into `/app/.medusa/server/node_modules/isolated-vm`.
   Moving to `dependencies` is simpler and, with prebuildify, `--ignore-scripts`
   stays harmless.)
   - Keep `loadIsolatedVm()`'s **indirect string specifier** (`const specifier:
     string = "isolated-vm"; await import(specifier)`) — tsc still won't resolve a
     variable specifier, so the #493 TS2307 prod-build trap stays closed even with
     the dep present.
   - Also bump `engines.node` to `>=22` in root + backend `package.json` to match.
3. **Audit prod `execute_code` nodes for external `packages`** before flipping the
   flag — see below.
4. **Set `VFLOW_USE_ISOLATED_VM=true`** in prod SSM only after 1–3 land + the audit
   clears. Default OFF until then.

### Migration risk to test on the Node-22 PR
Every native dep recompiles/reloads against Node 22 ABI: `sharp`, `pg`/`pg-native`
if any, argon/bcrypt, etc. Medusa 2.15.5 supports Node 20 **and** 22 (22 is LTS), so
this is expected-safe, but the PR must boot the full prod-like image and run
`predeploy:force` + smoke the admin/storefront before merge (it auto-deploys).

## The `packages` decision (gates flipping the flag)

Isolated mode **rejects** any `execute_code` node that requests external npm
`packages` (only built-ins `lodash`/`dayjs`/`validator`/`uuid`/`crypto` are bridged
— see `execute-code.ts` ~L333). Enabling `VFLOW_USE_ISOLATED_VM` therefore **breaks
any live flow whose node sets a `packages` array.**

Audit before flipping. Each `execute_code` node stores its config (incl. `packages`)
in the visual-flow definition. Enumerate via admin/DB:
- Inspect saved flow definitions for `operation: "execute_code"` nodes with a
  non-empty `options.packages`.
- For each, either (a) confirm it only uses a built-in (rewrite to drop `packages`),
  or (b) keep that flow on the in-process backend / defer.

If any prod flow needs true external packages, isolated mode can't be a global flip
— it'd need per-flow opt-in (future work: bridge a vetted package allowlist into the
isolate, or run those flows in-process).

## Recommendation

Two-step, human-owned:
1. **Infra PR** (separate, carefully verified): Node 22 base image + move
   isolated-vm to `dependencies` + `engines` bump. Verify a full local Docker build
   boots and `runInIsolate` loads in a prod-like container (ECS run-task off
   `jyt-prod-medusa-server`).
2. **Enablement PR/SSM**: after the `packages` audit clears, set
   `VFLOW_USE_ISOLATED_VM=true` in prod SSM (tags `copilot-application=jyt`,
   `copilot-environment=prod`).

## Refs
- `apps/backend/src/modules/visual_flows/operations/isolated-runner.ts`
  (`loadIsolatedVm`, `isIsolatedVmEnabled`, `runInIsolate`)
- `apps/backend/src/modules/visual_flows/operations/execute-code.ts` (~L316 backend
  pick; ~L333 packages rejection)
- `apps/backend/Dockerfile` (builder L10, runtime L47/L70)
- `apps/backend/package.json` (`optionalDependencies.isolated-vm`)
- Prior: #459 (RCE analysis), #465 (sandbox impl), #493 (the prod-build TS2307
  optional-dep trap — keep the indirect specifier)
