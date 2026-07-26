# syntax=docker/dockerfile:1.6
# -----------------------------------------------------------------------------
# Medusa server + worker image for Railway.
# The same image is used for both services — MEDUSA_WORKER_MODE selects which
# role to run (server runs migrations first; worker just starts).
#
# Built from the repo root context: `docker build -f apps/backend/Dockerfile .`
# -----------------------------------------------------------------------------

FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

# Docker's BuildKit has no TTY, so pnpm aborts when it needs to purge a stale
# node_modules dir (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). CI=true is
# pnpm's own documented fix — it auto-confirms the purge non-interactively.
ENV CI=true

# registry.npmjs.org answers a cold install's burst of parallel requests with
# HTTP 429 (ERR_PNPM_FETCH_429), which fails the build outright. pnpm's default
# 16 sockets and near-zero backoff turn a transient rate-limit into a hard stop,
# so: fewer concurrent sockets, and retries that actually wait. Set as env
# (npm_config_*) rather than in .npmrc so developer machines keep pnpm's faster
# defaults — this only ever mattered inside the build.
ENV npm_config_network_concurrency=8 \
    npm_config_fetch_retries=6 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000

# One explicit store path, so the runtime stage can reuse what this stage
# downloads instead of resolving the whole tree again from the registry.
ENV PNPM_STORE_DIR=/pnpm-store

WORKDIR /app

# Build-time env for the admin (Vite) bundle. Vite inlines these at compile
# time; they can't be set at runtime. Public URLs only — no secrets here.
ARG MEDUSA_BACKEND_URL
ARG VITE_MEDUSA_BACKEND_URL
ARG VITE_MEDIA_GALLERY_BASE_URL
ARG VITE_STOREFRONT_URL
ENV MEDUSA_BACKEND_URL=${MEDUSA_BACKEND_URL}
ENV VITE_MEDUSA_BACKEND_URL=${VITE_MEDUSA_BACKEND_URL}
ENV VITE_MEDIA_GALLERY_BASE_URL=${VITE_MEDIA_GALLERY_BASE_URL}
ENV VITE_STOREFRONT_URL=${VITE_STOREFRONT_URL}

# --- dependency layer (cached on the lockfile alone) -------------------------
# `pnpm fetch` populates the virtual store from pnpm-lock.yaml ONLY, so this
# layer — the slow part (download + extract every dependency) — is reused across
# every commit that doesn't change the lockfile. Previously `COPY . .` ran
# BEFORE install, so ANY source edit busted the install layer and pnpm
# re-downloaded everything on every build. .npmrc carries the shamefully-hoist
# config Medusa's phantom deps need.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch --store-dir "$PNPM_STORE_DIR"

# Now bring in the full workspace. .dockerignore trims node_modules/.medusa/etc.
COPY . .

# Use the production Medusa config for the build.
RUN cp apps/backend/medusa-config.prod.ts apps/backend/medusa-config.ts

# --offline: resolve entirely from the store `pnpm fetch` populated — no network,
# so this stays fast even when the layer re-runs on a source change.
RUN pnpm install --frozen-lockfile --offline --store-dir "$PNPM_STORE_DIR"

# Root build proxies to `pnpm --filter @jyt/backend build`, which runs from
# apps/backend and produces apps/backend/.medusa/server. The workflow-schema
# scan (build:schemas) + tsc type-resolution (resolve:aliases) push Node past
# its ~2GB default old-space heap on this project, so raise the limit to avoid
# a `JavaScript heap out of memory` (SIGABRT, exit 134) build crash.
ENV NODE_OPTIONS="--max-old-space-size=6144"
RUN pnpm run build

# -----------------------------------------------------------------------------
# Runtime image — ships only the compiled server and its prod deps.
# -----------------------------------------------------------------------------
FROM node:22-slim AS runtime

ENV NODE_ENV=production

# libatomic1: the embedded census P2P stack (corestore -> rocksdb-native,
# hyperswarm -> sodium-native/udx-native) ships prebuilt linux-x64 .node addons
# that dynamically link libatomic.so.1, which node:22-slim does NOT include.
# Without it the addon dlopen fails and require-addon reports a misleading
# ADDON_NOT_FOUND — the reason embedded P2P read as "DOA" and census fell back to
# proxy mode. Adding this one lib lets the native stack load in-image. Verified
# in a linux/amd64 node:22-slim container: corestore.ready + hyperbee get +
# hyperswarm keypair all succeed once libatomic1 is present.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl libatomic1 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

# Docker's BuildKit has no TTY, so pnpm aborts when it needs to purge a stale
# node_modules dir (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). CI=true is
# pnpm's own documented fix — it auto-confirms the purge non-interactively.
ENV CI=true

# Same rate-limit guard as the builder — see the note there. This stage is the
# one that actually hit ERR_PNPM_FETCH_429: unlike the builder it has no
# lockfile and no store, so `pnpm install --prod` below resolved the compiled
# server's whole dependency tree (~2.4k packages) straight from the registry.
ENV npm_config_network_concurrency=8 \
    npm_config_fetch_retries=6 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000

WORKDIR /app

# Bring in the compiled server, the generated workflow schemas, and .npmrc
# (needed for shamefully-hoist so Medusa's phantom deps resolve at runtime).
# patches/ is intentionally excluded — the sole patch targets `medusa develop`
# (dev-only) and is gitignored.
COPY --from=builder /app/apps/backend/.medusa ./.medusa
COPY --from=builder /app/apps/backend/workflow-schemas.json ./workflow-schemas.json
COPY --from=builder /app/.npmrc ./.npmrc

# Medusa compiles into .medusa/server with its own package.json. Install prod
# deps there. --ignore-scripts skips the patch-package postinstall (dev-only).
WORKDIR /app/.medusa/server

# The compiled server carries an internal workspace dependency
# (@jytextiles/mikrohyperbee — the Hyperbee-backed DAL the personproperty module
# uses) declared via the `workspace:*` protocol. The prod install below runs with
# --ignore-workspace (there is no pnpm workspace in the runtime image), and pnpm
# cannot resolve `workspace:*` without one → ERR_PNPM_WORKSPACE_PKG_NOT_FOUND.
# So: (1) drop that entry from the generated package.json before installing,
# (2) install the remaining prod deps (including hyperbee/corestore, which the
# package declares only as an OPTIONAL peer), then (3) vendor the prebuilt
# package straight into node_modules. The package is Medusa-free CommonJS with no
# runtime deps of its own and its dist/ is built by the package's `prepare` (tsc)
# during the builder install above, so this copy is self-contained.
RUN node -e "const fs=require('fs');const p=require('./package.json');if(p.dependencies){delete p.dependencies['@jytextiles/mikrohyperbee'];}fs.writeFileSync('./package.json',JSON.stringify(p,null,2)+'\n');"
# The compiled server's prod deps are the backend's own deps, which the builder
# already downloaded from the lockfile. Bind-mounting that store lets this
# install resolve locally instead of re-fetching the tree — a bind mount (not a
# COPY) so the multi-GB store never lands in a layer of the shipped image, and
# not a cache mount because BuildKit does not export those to the `type=gha`
# cache the deploy workflow uses, so in CI a cache mount would always be cold.
# `rw` gives pnpm the writable store it wants; the overlay is discarded with the
# mount. `--prefer-offline` (not `--offline`) so anything genuinely absent —
# this package.json carries ranges, not the lockfile's pinned versions — can
# still come over the network.
RUN --mount=type=bind,from=builder,source=/pnpm-store,target=/pnpm-store,rw \
    pnpm install --prod --ignore-workspace --ignore-scripts \
      --store-dir /pnpm-store --prefer-offline
COPY --from=builder /app/packages/mikrohyperbee/package.json ./node_modules/@jytextiles/mikrohyperbee/package.json
COPY --from=builder /app/packages/mikrohyperbee/dist ./node_modules/@jytextiles/mikrohyperbee/dist

EXPOSE 9000

# Both roles just start — neither migrates inline. Migrations are run as a
# separate, gated one-off ECS task by the deploy workflow
# (deploy/aws/scripts/run-migrations.sh) BEFORE the services roll, so a slow
# migration no longer blocks server boot / the /health check.
#
# Escape hatch: set RUN_MIGRATIONS_ON_BOOT=1 to restore the old inline behavior
# (e.g. for a local/standalone run with no separate migration step).
CMD ["sh", "-c", "if [ \"${RUN_MIGRATIONS_ON_BOOT}\" = \"1\" ] && [ \"${MEDUSA_WORKER_MODE}\" != \"worker\" ]; then pnpm predeploy:force; fi; pnpm run start"]
