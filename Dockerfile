# syntax=docker/dockerfile:1.6
# -----------------------------------------------------------------------------
# Medusa server + worker image for Railway.
# The same image is used for both services — MEDUSA_WORKER_MODE selects which
# role to run (server runs migrations first; worker just starts).
# -----------------------------------------------------------------------------

FROM node:20-slim AS builder

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

# Copy everything — pnpm-workspace.yaml references apps/* and pnpm expects
# those manifests to exist. A .dockerignore trims node_modules/.medusa/etc.
COPY . .

# Use the production Medusa config for the build.
RUN cp medusa-config.prod.ts medusa-config.ts

RUN pnpm install --frozen-lockfile

# Root build script: medusa build + resolve:aliases + build:schemas.
RUN pnpm run build

# -----------------------------------------------------------------------------
# Runtime image — ships only the compiled server and its prod deps.
# -----------------------------------------------------------------------------
FROM node:20-slim AS runtime

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
COPY --from=builder /app/.medusa ./.medusa
COPY --from=builder /app/workflow-schemas.json ./workflow-schemas.json
COPY --from=builder /app/.npmrc ./.npmrc

# Medusa compiles into .medusa/server with its own package.json. Install prod
# deps there. --ignore-scripts skips the patch-package postinstall (dev-only).
WORKDIR /app/.medusa/server
RUN pnpm install --prod --ignore-workspace --ignore-scripts

EXPOSE 9000

# Server runs predeploy:force (db:migrate --execute-all-links) before starting.
# Worker skips migrations — the server owns the schema.
CMD ["sh", "-c", "if [ \"${MEDUSA_WORKER_MODE}\" = \"worker\" ]; then pnpm run start; else pnpm predeploy:force && pnpm run start; fi"]
