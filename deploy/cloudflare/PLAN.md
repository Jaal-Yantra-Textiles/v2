# Cloudflare Containers deployment plan — JYT backend

> ⚠️  **DEFERRED as of 2026-05-17.** We pivoted to AWS Lightsail (single VM
> with docker-compose) for the immediate production deploy. See
> `deploy/aws/PLAN.md` for the active plan.
>
> This file and the rest of `deploy/cloudflare/` are kept intact as a
> documented future option. Reasons we may revisit:
>   - traffic growth pushing past what a single VM handles
>   - desire for region-scaled HA without running our own infra
>   - migration to a fully serverless story
>
> Below is the original plan as written before the pivot.
>
> ---
>
> Status: **DRAFT — review before any code lands.**
> Date: 2026-05-15
> Owner: Saransh
> Target: deploy the Medusa 2.x backend (`apps/backend`) on Cloudflare Containers,
> with Railway as the Postgres host and Upstash as the Redis host.

---

## 1. Decisions locked in this round

| Decision | Choice | Rationale |
|---|---|---|
| Compute target | **Cloudflare Containers** | User chose CF as the platform; Containers is the only CF product that fits a long-running Node.js + Express server. |
| Postgres | **Railway PG, direct TCP from container** | Hyperdrive is a Workers-only binding and unreachable from a container process. Railway's built-in PgBouncer handles pooling. |
| Redis | **Upstash Redis** (TCP) | Native TCP from container; scale-to-zero; standard pick for CF-adjacent stacks. |
| File storage | **Cloudflare R2** via `@medusajs/file-s3` | S3-compatible, free egress, sits inside the CF ecosystem. |
| Process topology | **3 container services**: 2× server (HA), 1× worker | Medusa needs a separate `MEDUSA_WORKER_MODE=worker` process for subscribers, jobs, and the workflow executor. Server runs HA pair behind a Worker router. |
| Region placement | **Accept whatever CF places** (documented constraint) | CF Containers do not support region pinning. EU users hitting US-region Railway PG will eat Atlantic latency. Re-evaluate when traffic warrants moving PG to Neon. |
| Image build | **Reuse existing `apps/backend/Dockerfile`** | Already production-grade, used by Railway today. Only change is forcing `linux/amd64` build platform. |
| Migrations | **Server boot runs `predeploy:force`** (current pattern) | MikroORM uses PG advisory locks, safe to race across 2 HA instances. No separate migration job needed. |

## 2. Decisions still open

These need to be answered before code lands. The plan flags each in-line where it bites.

1. **Custom domain.** What hostname will the API live on? `api.jaalyantra.in`? A subdomain on a new domain? Determines DNS + TLS setup.
2. **Account region for R2 bucket.** R2 is regionless but you pick a "location hint". Closest to expected user traffic.
3. **Sentry / log destination.** Stay on whatever's wired today, or switch to CF's `[observability]` only?
4. **Old Railway services.** Keep them as a warm fallback for the first N weeks of the cutover, or decommission immediately after CF goes live?
5. **CI/CD.** Deploy from local `wrangler` while we shake it out, or wire GitHub Actions from day one?

## 3. Architecture

```
                ┌──────────────────────────────────┐
                │  Cloudflare edge: DNS, WAF, CDN  │
                │  api.jaalyantra.in  (TBD)        │
                └──────────────────┬───────────────┘
                                   │
                ┌──────────────────▼───────────────┐
                │  CF Worker  (medusa-router)      │
                │  - routes ALL inbound traffic    │
                │  - load-balances across server   │
                │    container instances           │
                └──────────┬───────────────┬───────┘
                           │               │
                    ┌──────▼─────┐  ┌──────▼─────┐
                    │ Server #1  │  │ Server #2  │   ← Container class: MedusaServer
                    │ standard-2 │  │ standard-2 │     - port 9000
                    │ MEDUSA_    │  │ MEDUSA_    │     - sleepAfter: long (warm)
                    │ WORKER_    │  │ WORKER_    │     - max_instances: 2
                    │ MODE=server│  │ MODE=server│     - same image
                    └──────┬─────┘  └──────┬─────┘
                           │               │
                           └───────┬───────┘
                                   │
                          (no public route)
                                   │
                           ┌───────▼────────┐
                           │ Worker process │   ← Container class: MedusaWorker
                           │ standard-1     │     - NO port exposed
                           │ MEDUSA_        │     - sleepAfter: never (always on)
                           │ WORKER_MODE    │     - max_instances: 1
                           │ =worker        │     - same image
                           └───────┬────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
  ┌─────▼────────┐         ┌───────▼───────┐         ┌────────▼─────┐
  │ Railway PG   │         │ Upstash Redis │         │ Cloudflare   │
  │ + PgBouncer  │         │ (TCP)         │         │ R2 bucket    │
  │ (direct TCP) │         │               │         │ + API token  │
  └──────────────┘         └───────────────┘         └──────────────┘
```

### 3.1 What goes where

| Concern | Where it lives | Why |
|---|---|---|
| HTTP termination, TLS | CF edge (Worker) | Free TLS, WAF in front. |
| Routing | Worker (`medusa-router`) | Worker fetches the container and forwards the request. Required by CF Containers' design — all inbound traffic to a container flows through its companion Worker. |
| API server (Express) | `MedusaServer` container, ×2 | HA for availability; load balance via `getRandom(env.MEDUSA_SERVER, 2)`. |
| Background workflows, subscribers, scheduled jobs | `MedusaWorker` container, ×1 | Medusa's worker mode. Single instance — running 2 would double-execute scheduled jobs. |
| Postgres pool | inside each container (`pg`) | Direct TCP to Railway. Railway PgBouncer collapses connections. |
| Cache, event bus, workflow engine state | Upstash Redis | Standard Medusa prod requirement. |
| File uploads | R2 via `@medusajs/file-s3` | S3-compatible; container only signs URLs and streams uploads. |
| Migrations | Server boot (`predeploy:force`) | Current Railway pattern. MikroORM advisory lock makes it race-safe across 2 server instances. |
| Logs / errors | CF `[observability]` + Sentry (existing) | CF observability for stdout/stderr; Sentry for structured errors. |

### 3.2 What we are NOT doing (and why)

- ❌ **Hyperdrive in front of Railway.** Not callable from a container. Direct TCP + Railway's PgBouncer give the same effective pool.
- ❌ **Self-hosted Postgres in a CF container.** No persistent disk guarantees, no backups, no HA. Trivial to corrupt.
- ❌ **Separate migration container/job.** Medusa's `predeploy:force` is already idempotent and lock-coordinated. Adding a third orchestration step is complexity for no gain today.
- ❌ **Region pinning.** Not supported. We document it as a known limitation rather than fight the platform.
- ❌ **`min_instances` configuration.** Not exposed by CF. We use long `sleepAfter` instead.

---

## 4. New files to add

Everything below lives under `deploy/cloudflare/`:

```
deploy/cloudflare/
├── PLAN.md                 ← this file
├── wrangler.toml           ← Worker + Container config
├── src/
│   ├── worker.ts           ← the routing Worker
│   ├── server-container.ts ← MedusaServer Container class
│   └── worker-container.ts ← MedusaWorker Container class
├── secrets.example.sh      ← list of `wrangler secret put` commands (no values)
└── README.md               ← runbook for deploy / rollback / debug
```

**Nothing changes in `apps/backend/`.** The Dockerfile, env structure, and Medusa config stay exactly as they are for Railway.

### 4.1 `wrangler.toml` (sketch — for review, not yet written)

```toml
name = "medusa-router"
main = "src/worker.ts"
compatibility_date = "2026-05-01"

# ─── API server containers (HA pair) ─────────────────────────────────
[[containers]]
class_name = "MedusaServer"
image = "../../apps/backend/Dockerfile"   # built from repo root context
image_build_context = "../.."             # repo root for pnpm workspace
instance_type = "standard-2"              # 1 vCPU, 6 GiB, 12 GB disk
max_instances = 2

[[durable_objects.bindings]]
name = "MEDUSA_SERVER"
class_name = "MedusaServer"

# ─── Worker process container (singleton) ────────────────────────────
[[containers]]
class_name = "MedusaWorker"
image = "../../apps/backend/Dockerfile"
image_build_context = "../.."
instance_type = "standard-1"              # 1/2 vCPU, 4 GiB
max_instances = 1

[[durable_objects.bindings]]
name = "MEDUSA_WORKER"
class_name = "MedusaWorker"

# ─── DO migrations (required for Container DO classes) ───────────────
[[migrations]]
tag = "v1"
new_sqlite_classes = ["MedusaServer", "MedusaWorker"]

# ─── Non-secret vars; secrets go via `wrangler secret put` ───────────
[vars]
NODE_ENV = "production"

[observability]
enabled = true

# ─── Routes ──────────────────────────────────────────────────────────
[[routes]]
pattern = "api.jaalyantra.in/*"   # TBD — see open question #1
zone_name = "jaalyantra.in"
```

> **Open: image build context.** wrangler builds the image with `docker buildx`.
> We must verify the syntax for "Dockerfile is in subdir, build context is repo
> root". This pattern is required because `apps/backend/Dockerfile` does
> `COPY . .` from repo root (it needs the pnpm workspace). If `image_build_context`
> isn't the exact key wrangler uses, we'll adjust during the trial build.

### 4.2 The routing Worker (`src/worker.ts`) — sketch

```ts
import { getRandom } from "cloudflare:containers";
import { MedusaServer } from "./server-container";
import { MedusaWorker } from "./worker-container";

export { MedusaServer, MedusaWorker };

interface Env {
  MEDUSA_SERVER: DurableObjectNamespace<MedusaServer>;
  MEDUSA_WORKER: DurableObjectNamespace<MedusaWorker>;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Load-balance across the 2 server instances.
    const container = await getRandom(env.MEDUSA_SERVER, 2);
    return container.fetch(req);
  },

  // Cron triggers (if any) can poke the worker container's HTTP port
  // — but for Medusa, the worker self-schedules via its job module,
  // so we don't need to wire crons here. Worker stays warm via long
  // sleepAfter and is invoked from `scheduled()` only if we want to
  // explicitly keep it alive.
};
```

### 4.3 Container classes — sketch

```ts
// src/server-container.ts
import { Container } from "cloudflare:containers";
import { env } from "cloudflare:workers";

export class MedusaServer extends Container {
  defaultPort = 9000;
  sleepAfter = "30m";   // long enough that idle traffic doesn't cold-start

  envVars = {
    NODE_ENV: "production",
    MEDUSA_WORKER_MODE: "server",
    DATABASE_URL:           env.DATABASE_URL,
    REDIS_URL:              env.REDIS_URL,
    JWT_SECRET:             env.JWT_SECRET,
    COOKIE_SECRET:          env.COOKIE_SECRET,
    S3_ACCESS_KEY_ID:       env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY:   env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET:              env.S3_BUCKET,
    S3_ENDPOINT:            env.S3_ENDPOINT,
    // ...all the other vars from .env.railway.server
  };

  override onError(e: unknown) { console.error("[MedusaServer]", e); }
}
```

```ts
// src/worker-container.ts
import { Container } from "cloudflare:containers";
import { env } from "cloudflare:workers";

export class MedusaWorker extends Container {
  // No defaultPort — the worker doesn't serve HTTP.
  // CF will still keep the container alive via its lifecycle hooks.

  sleepAfter = "1h";    // worker should basically never sleep
  // (CF doesn't expose "never sleep"; 1h is a long upper bound)

  envVars = {
    NODE_ENV: "production",
    MEDUSA_WORKER_MODE: "worker",
    DATABASE_URL:    env.DATABASE_URL,
    REDIS_URL:       env.REDIS_URL,
    // worker needs the same DB+Redis credentials, NOT the JWT/cookie/S3
    // secrets — those are API-server concerns.
  };

  override onError(e: unknown) { console.error("[MedusaWorker]", e); }
}
```

> **Open: keeping the worker container alive without a public route.**
> CF Containers normally start lazily on incoming Worker traffic. Since the
> worker has no inbound HTTP, we need a "kick-start" pattern. Two options:
> 1. Worker `scheduled()` cron pings `MEDUSA_WORKER` every minute.
> 2. Worker `fetch()` proactively starts the worker container on the first
>    request after boot, then relies on `sleepAfter` to keep it alive.
>
> Confirm which is current best practice during the trial deploy.

---

## 5. Build & image

### 5.1 Platform

The existing Dockerfile is `FROM node:20-slim`. On Apple Silicon (your dev machine), Docker defaults to `arm64`. CF Containers requires `linux/amd64`.

**Three ways to handle it:**

| Option | How | When to use |
|---|---|---|
| A. wrangler does it | `wrangler deploy` with buildx ought to build amd64 if we set platform in `wrangler.toml` (key TBD — verify). | Default; least friction. |
| B. Explicit `--platform` | Add a `build` block to `wrangler.toml` that calls `docker buildx build --platform linux/amd64 ...`. | If A doesn't expose the knob. |
| C. Pre-built in CI | GitHub Actions builds amd64, pushes to Cloudflare Registry, wrangler references the tag. | When local builds get slow or we want reproducibility. Phase 2. |

Phase 1: try A. Fall back to B if needed.

### 5.2 Image size budget

Current Railway image (post multi-stage prune) should be in the 600 MB – 1.2 GB range. `standard-2` has a 12 GB disk allocation — plenty of headroom. Don't over-optimize on size in phase 1.

### 5.3 Cache

`wrangler deploy` rebuilds from local Dockerfile on each invocation. Docker's local layer cache makes incremental builds fast as long as we don't change the `COPY . .` early. Since the Dockerfile copies everything, every code change invalidates the dep-install layer — this is the same trade-off Railway has. Phase 2: optimize layer order if it becomes a pain.

---

## 6. Env vars and secrets

The current Railway deployment has the env split:

- `apps/backend/.env.railway.server` → API server vars
- `apps/backend/.env.railway.worker` → Worker process vars

We mirror that split into CF, but **store as Worker secrets** (not in `wrangler.toml`), then forward to the container via the `envVars` field on each Container class.

### 6.1 Setting secrets (one-time per environment)

```bash
# From deploy/cloudflare/, with `wrangler login` already done:
wrangler secret put DATABASE_URL          # postgres://...@railway.../db
wrangler secret put REDIS_URL             # rediss://...@upstash.../...
wrangler secret put JWT_SECRET
wrangler secret put COOKIE_SECRET
wrangler secret put S3_ACCESS_KEY_ID      # R2 token
wrangler secret put S3_SECRET_ACCESS_KEY  # R2 token
wrangler secret put S3_BUCKET
wrangler secret put S3_ENDPOINT           # https://<account>.r2.cloudflarestorage.com
# + every other secret from .env.railway.server / .env.railway.worker
```

### 6.2 Non-secret vars

`NODE_ENV=production`, public URLs (`MEDUSA_BACKEND_URL` etc.), feature flags. Go in `[vars]` block in `wrangler.toml`.

### 6.3 Per-role split

`MEDUSA_WORKER_MODE` is hardcoded in each Container class (`"server"` vs `"worker"`) — not a shared secret. That's how the same image runs both roles.

### 6.4 What needs new credentials (not reusable from Railway)

- **R2 API token + bucket.** New. Provision in CF dashboard → R2 → tokens.
- **Wrangler-side secrets are scoped per-Worker**, not per-Container — but we only have one Worker (the router), so this is moot.

---

## 7. Migrations and rollout

### 7.1 Migration order on a single deploy

Current Railway behavior (see `apps/backend/Dockerfile:76`):
```sh
if [ "${MEDUSA_WORKER_MODE}" = "worker" ]; then
  pnpm run start              # worker — no migration
else
  pnpm predeploy:force && pnpm run start   # server — migrates first
fi
```

This stays. On CF:

1. `wrangler deploy` rolls out new image to all 3 container instances.
2. Both server instances try to run `predeploy:force` in parallel. MikroORM takes a PG advisory lock; first wins, second waits + no-ops, both then start their Express server.
3. Worker container starts; it skips migrations entirely.

### 7.2 Risk: stale worker against new schema

If the worker container boots **before** server #1 has finished migrations, the worker could query against the old schema for ~30s. In practice the worker's first DB calls are likely fine (idempotent reads from the workflow queue), but if we ever ship a destructive migration this becomes scary.

**Mitigation (phase 2, not phase 1):** add a tiny CI step that runs `pnpm --filter @jyt/backend predeploy:force` against Railway *before* calling `wrangler deploy`. Then both containers start clean. Cheap and removes the race entirely. Recommend doing this once we're past initial cutover.

### 7.3 Rollback

CF Containers does **not** retain old image versions automatically. Rollback strategy:

- **Phase 1 (manual):** keep the previous git SHA tagged. `git checkout <sha> && wrangler deploy` rebuilds and re-rolls the old image. Slow (~5 min) but reliable.
- **Phase 2:** push images to Cloudflare Registry tagged by git SHA. `wrangler deploy --image medusa-api:<sha>` becomes instant.

For phase 1, the rollback SLA is "as long as a fresh build takes" — call it 8–10 minutes. Plan for it before the cutover.

### 7.4 Cutover plan

1. Provision Upstash Redis, R2 bucket + token (no traffic yet).
2. Set all CF Worker secrets.
3. `wrangler deploy` to a staging Worker route (e.g. `api-cf.jaalyantra.in`).
4. Smoke test: hit `/health`, list a few admin endpoints, place a test order against staging.
5. Run the storefront's integration tests against the new endpoint.
6. Swap DNS: `api.jaalyantra.in` → CF (Worker route).
7. **Keep Railway warm for 7 days.** If CF misbehaves, swap DNS back.
8. Day 7+: decommission Railway Medusa services (Railway PG stays).

---

## 8. Observability

| Signal | Where |
|---|---|
| stdout/stderr | CF observability (Workers tab) → 3-day retention on Free, 7-day on Paid. `wrangler tail` for live. |
| Structured errors | Sentry (existing wiring, no change). Make sure `SENTRY_DSN` is in the secret set. |
| Container metrics (CPU, memory) | CF dashboard → Containers panel. |
| Slow queries / DB | Railway dashboard (unchanged). |
| Job/workflow runs | Medusa admin UI (unchanged). |

### 8.1 Health checks

Add a `GET /health` route to Medusa that:
- Pings the DB (`SELECT 1`).
- Pings Redis.
- Returns 200 within 1 s or 503.

The Worker can probe this on cold-start to fail fast if a container booted broken.

---

## 9. Known constraints / risks

1. **Region placement is non-deterministic.** Documented above. Re-evaluate after 4 weeks of prod data.
2. **Cold-start latency is ~10–25s** (CF container boot + Medusa init). Long `sleepAfter` keeps containers warm, but the *first* request after a deploy will be slow. Manual mitigation: `wrangler deploy && curl https://api.jaalyantra.in/health` to pre-warm.
3. **No `min_instances`.** If CF reaps an idle container, the next request cold-starts. Set `sleepAfter` high (30m for server, 1h for worker).
4. **Worker container has no inbound port.** Keep-alive pattern needs to be confirmed during the trial deploy (cron ping vs. lazy start).
5. **Hyperdrive ruled out.** Documented. Direct TCP + Railway PgBouncer is the substitute.
6. **No native pre-deploy hook.** CI-driven migration is the upgrade path (phase 2).
7. **Build platform on Apple Silicon.** Must produce `linux/amd64`. Will verify the wrangler knob during trial.
8. **R2 + AWS SDK v3 checksum gotcha.** If we see `NotImplemented: Header 'x-amz-checksum-crc32'`, add `requestChecksumCalculation: "WHEN_REQUIRED"` to the file-s3 `additional_client_config`. CF says this is fixed at the R2 layer now, but worth knowing.

---

## 10. Costs (rough)

Order-of-magnitude only; verify against CF's pricing calculator before committing.

| Component | Tier | Approx monthly |
|---|---|---|
| 2× `standard-2` (server, kept warm) | 1 vCPU + 6 GiB × 2, ~24h/day | ~$60–100/mo combined |
| 1× `standard-1` (worker, kept warm) | 0.5 vCPU + 4 GiB, ~24h/day | ~$25–40/mo |
| Worker (router) | Effectively free at our traffic | ~$0–5 |
| R2 (storage + Class A ops) | ~$0.015/GB-mo + $4.50/M writes | Tiny until catalog grows |
| Upstash Redis | Pay-as-you-go | ~$10–30 depending on commands/mo |
| **Railway PG** | unchanged | (existing line item) |

Total new CF spend, rough: **~$100–180/mo** for compute, plus storage/Redis. Comparable to a small Railway plan.

---

## 11. Phased rollout

### Phase 0 — this plan
- [ ] User reviews PLAN.md, leaves comments
- [ ] Resolve the 5 open questions in §2
- [ ] Mark plan as approved

### Phase 1 — staging deploy
- [ ] Provision R2 bucket + token
- [ ] Provision Upstash Redis
- [ ] Create `deploy/cloudflare/wrangler.toml` + container classes + Worker
- [ ] Verify Dockerfile builds `linux/amd64` via wrangler
- [ ] `wrangler secret put …` for full secret set
- [ ] `wrangler deploy` to staging Worker (no DNS yet)
- [ ] Smoke test on `*.workers.dev` URL
- [ ] Run storefront integration tests against staging
- [ ] Verify worker container is actually running scheduled jobs
- [ ] Verify R2 file uploads work end-to-end

### Phase 2 — production cutover
- [ ] Add `api.jaalyantra.in` (or chosen domain) route in wrangler.toml
- [ ] DNS swap, monitor for 24h
- [ ] Keep Railway services warm for 7 days as fallback
- [ ] Document the rollback runbook in `deploy/cloudflare/README.md`

### Phase 3 — hardening (after 4 weeks in prod)
- [ ] Move migration step out of container boot into CI
- [ ] Push images to CF Registry by SHA for instant rollbacks
- [ ] GitHub Actions for `wrangler deploy` on `main` merge
- [ ] Evaluate Neon migration if region latency is hurting EU users

---

## 12. Out of scope (intentionally)

- `apps/storefront`, `apps/partner-ui`, `apps/storefront-starter` deployments — those stay where they are (Vercel? separate decision).
- Mastra workflows — they run in-process with Medusa, so they ride along automatically.
- The `.mastra/` build artifacts — already in `.dockerignore`, regenerated inside the image.
- Multi-region anything — out of scope until region placement becomes a real bottleneck.
