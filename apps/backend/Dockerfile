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
RUN pnpm fetch

# Now bring in the full workspace. .dockerignore trims node_modules/.medusa/etc.
COPY . .

# Use the production Medusa config for the build.
RUN cp apps/backend/medusa-config.prod.ts apps/backend/medusa-config.ts

# --offline: resolve entirely from the store `pnpm fetch` populated — no network,
# so this stays fast even when the layer re-runs on a source change.
RUN pnpm install --frozen-lockfile --offline

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

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

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
RUN pnpm install --prod --ignore-workspace --ignore-scripts

EXPOSE 9000

# Both roles just start — neither migrates inline. Migrations are run as a
# separate, gated one-off ECS task by the deploy workflow
# (deploy/aws/scripts/run-migrations.sh) BEFORE the services roll, so a slow
# migration no longer blocks server boot / the /health check.
#
# Escape hatch: set RUN_MIGRATIONS_ON_BOOT=1 to restore the old inline behavior
# (e.g. for a local/standalone run with no separate migration step).
CMD ["sh", "-c", "if [ \"${RUN_MIGRATIONS_ON_BOOT}\" = \"1\" ] && [ \"${MEDUSA_WORKER_MODE}\" != \"worker\" ]; then pnpm predeploy:force; fi; pnpm run start"]
