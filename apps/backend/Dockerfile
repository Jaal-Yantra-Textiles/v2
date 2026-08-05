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

# --- runtime dependency tree ------------------------------------------------
# The runtime stage used to run its own `pnpm install --prod` against the
# package.json `medusa build` generates. That stage has no lockfile, so pnpm
# re-resolved ~2.5k ranges against registry.npmjs.org on every build — which is
# what earned the ERR_PNPM_FETCH_429 that broke the deploy (the store #1173
# bind-mounted holds tarballs; resolution needs *metadata*, a different cache
# the builder never fills). It also ran with --ignore-workspace, which discards
# root `pnpm.overrides`, so the shipped image floated off our pins — the
# deliberate `zod: 4.2.0` pin (4.4.3 breaks boot via zod-to-openapi `.omit`)
# was measured at 4.4.3 inside the image.
#
# `pnpm deploy` builds the same tree here instead, from the workspace lockfile:
# versions come from the lockfile rather than a re-resolve, so overrides are
# honoured and two builds of one commit produce the same tree.
# --legacy because pnpm 10 otherwise requires
# inject-workspace-packages. It also injects the
# @jytextiles/mikrohyperbee workspace package properly, replacing the
# strip-the-dep-then-vendor-it-by-hand dance the runtime stage used to do.
#
# --prefer-offline, not --offline: packages/mikrohyperbee declares `hyperbee` as
# an OPTIONAL PEER with a `*` range, and a `*` cannot be satisfied from the
# lockfile, so a fully-offline deploy dies on ERR_PNPM_NO_OFFLINE_META for that
# one spec. Everything else comes from the store, so what remains is a handful
# of metadata requests where the old runtime install made ~2.5k. Measured on a
# cold build (empty metadata cache, as CI always is): this step takes ~2 min and
# logs no 429s, against ~15 min of backoff — or an outright failure — before.
RUN pnpm deploy --legacy --filter=@jyt/backend --prod --ignore-scripts \
      --prefer-offline --store-dir "$PNPM_STORE_DIR" /prod-deps

# `medusa build` copies apps/backend's dependencies verbatim into
# .medusa/server/package.json, so the tree above is exactly what the compiled
# server needs. That is an assumption about Medusa's build, not a guarantee —
# so assert it here. If a future Medusa adds a dependency of its own, this
# fails the build loudly instead of shipping an image that dies at require().
RUN node -e "\
const deps=Object.keys(require('/app/apps/backend/.medusa/server/package.json').dependencies||{});\
const missing=deps.filter(d=>!require('fs').existsSync('/prod-deps/node_modules/'+d+'/package.json'));\
if(missing.length){console.error('Missing from the deployed prod tree: '+missing.join(', '));process.exit(1);}\
console.log('runtime dep check OK ('+deps.length+' deps)');"

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

WORKDIR /app

# Bring in the compiled server, the generated workflow schemas, and .npmrc
# (needed for shamefully-hoist so Medusa's phantom deps resolve at runtime).
# patches/ is intentionally excluded — the sole patch targets `medusa develop`
# (dev-only) and is gitignored.
COPY --from=builder /app/apps/backend/.medusa ./.medusa
COPY --from=builder /app/apps/backend/workflow-schemas.json ./workflow-schemas.json
COPY --from=builder /app/.npmrc ./.npmrc

# Medusa compiles into .medusa/server with its own package.json, and expects its
# deps in a node_modules beside it. That tree is built in the builder stage from
# the lockfile (see the `pnpm deploy` note there) and copied in whole — this
# stage performs no install, so it needs no registry, no store mount and no
# lockfile. @jytextiles/mikrohyperbee comes along inside it, injected by the
# deploy rather than hand-vendored.
WORKDIR /app/.medusa/server

COPY --from=builder /prod-deps/node_modules ./node_modules

# The generated package.json still declares mikrohyperbee as `workspace:*`,
# which nothing in this image can resolve. Nothing installs here so it is inert,
# but rewrite it to the concrete version anyway so that a future `pnpm install`
# run inside the container fails on something honest rather than
# ERR_PNPM_WORKSPACE_PKG_NOT_FOUND.
RUN node -e "\
const fs=require('fs');const p=require('./package.json');\
if(p.dependencies&&p.dependencies['@jytextiles/mikrohyperbee']){\
p.dependencies['@jytextiles/mikrohyperbee']=require('./node_modules/@jytextiles/mikrohyperbee/package.json').version;\
fs.writeFileSync('./package.json',JSON.stringify(p,null,2)+'\n');}"

EXPOSE 9000

# Both roles just start — neither migrates inline. Migrations are run as a
# separate, gated one-off ECS task by the deploy workflow
# (deploy/aws/scripts/run-migrations.sh) BEFORE the services roll, so a slow
# migration no longer blocks server boot / the /health check.
#
# Escape hatch: set RUN_MIGRATIONS_ON_BOOT=1 to restore the old inline behavior
# (e.g. for a local/standalone run with no separate migration step).
CMD ["sh", "-c", "if [ \"${RUN_MIGRATIONS_ON_BOOT}\" = \"1\" ] && [ \"${MEDUSA_WORKER_MODE}\" != \"worker\" ]; then pnpm predeploy:force; fi; pnpm run start"]
