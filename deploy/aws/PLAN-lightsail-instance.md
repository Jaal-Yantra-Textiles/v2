# AWS Lightsail Instance deployment plan — JYT backend

> ⚠️  **DEFERRED as of 2026-05-18.** Pivoted to AWS ECS Fargate because:
>   1. User is building a multi-tenant Medusa-as-a-Service platform; Fargate's
>      primitives scale to N tenants, Lightsail Instance's don't.
>   2. Auto-scaling required from day one (Railway baseline is up to 5×
>      8 vCPU / 8 GB replicas); a fixed VM doesn't deliver this.
>   3. ECS Fargate can talk to the existing ElastiCache cluster privately via
>      VPC connector; Lightsail Instance can't.
>
> Active plan: `deploy/aws/PLAN.md` (Fargate).
>
> Kept as a fallback option for: cheaper staging environments, hobby deploys,
> or an emergency path if Fargate gets stuck.
>
> ---
>
> Status: **DRAFT — review before any code lands.**
> Date: 2026-05-17
> Owner: Saransh
> Target: deploy the Medusa 2.x backend (`apps/backend`) on a single AWS
> Lightsail instance (`us-east-1`, **4 GB RAM**) running docker-compose with
> `medusa-server` + `medusa-worker` + `valkey` + `caddy`. Railway Postgres
> stays as the primary DB. Cloudflare in front for DNS / WAF / CDN.

---

## 1. Decisions locked in this round

| Decision | Choice | Rationale |
|---|---|---|
| Compute target | **AWS Lightsail, 4 GB RAM, us-east-1** | "Just give me a Linux box" AWS product with comfortable headroom for Medusa + worker + Valkey + Caddy + room to grow. Static IP included, $40/mo. |
| Topology | **Single VM, everything in docker-compose** | Server + worker + Valkey + Caddy on one host. Simplest possible production shape. |
| Redis | **Valkey 8 container, AOF persistence to a docker volume** | Free, drop-in for Redis, AOF + Lightsail snapshots for durability. |
| Postgres | **Railway PG, unchanged** | No migration burden. Public TCP from Lightsail, `sslmode=require`. |
| TLS | **Caddy auto-TLS via Let's Encrypt** at the origin | Caddy handles cert issue + renewal with zero config. CF in "Full (Strict)" mode → end-to-end encryption. |
| CDN / DNS | **Cloudflare, proxied (orange cloud)** | Free WAF + cache + DDoS, hides origin IP. |
| File storage | **Cloudflare R2** via `@medusajs/file-s3` | Already planned. Free egress, S3-compatible. |
| ElastiCache cluster | **Kept** — wired as a replication target in a later phase | User intends to set up a Valkey replication service inside the AWS VPC to mirror the on-VM Valkey into ElastiCache for off-box backup / future migration. Not in Phase 1 scope. |
| CI/CD | **Manual SSH + `docker compose pull && up -d`** for Phase 1 | GitHub Actions wiring is Phase 2 once the manual path is verified. |
| Migrations | **Server boot runs `predeploy:force`** (unchanged) | MikroORM advisory lock makes restart-time migration safe. |
| Image source | **Pull `ghcr.io/jaal-yantra-textiles/v2:latest` from GHCR** (no local build) | Reuses your existing CI/CD pipeline that already publishes the image for Railway. Identical image = identical behavior. |
| Hostname | **`v3.jaalyantra.com`** (current Railway domain) | Cutover by swapping DNS A record. Zero changes in storefront / admin / partner UI configs. |

## 2. Decisions still open

1. ~~Hostname~~ → **resolved 2026-05-18**: keep `v3.jaalyantra.com` (current Railway domain). Confirm `jaalyantra.com` zone is on Cloudflare before cutover day.
2. **SSH key.** New Lightsail-managed key, or upload your existing public key?
3. **R2 bucket name + region hint.** Same call you would have made for the CF path — still applies here.
4. **Backup cadence.** Lightsail snapshots: daily automatic ($2/mo for ~10 snapshots), or manual only?
5. **Sentry?** Not currently in your config; skip for Phase 1 unless you want to add it now.
6. **ElastiCache replication design.** What's the intended shape — Valkey-native `REPLICAOF` from on-VM to ElastiCache? A separate replication daemon? Plan it as a Phase 2 doc; not blocking Phase 1.

## 3. Architecture

```
                    ┌──────────────────────────────────────┐
                    │  Cloudflare (proxied)                │
                    │  v3.jaalyantra.com  → A → 3.x.x.x    │
                    │  WAF + CDN + DDoS + TLS at edge      │
                    └──────────────────┬───────────────────┘
                                       │ HTTPS (Full Strict)
                                       ▼
   ┌────────────────────────────────────────────────────────────────┐
   │   AWS Lightsail instance (us-east-1, 4 GB RAM, static IP)      │
   │                                                                │
   │   ┌──────────────────────────────────────────────────────┐     │
   │   │  Caddy 2  (host network or 80/443 ports)             │     │
   │   │  auto-TLS via Let's Encrypt                          │     │
   │   │  reverse-proxy → medusa-server:9000                  │     │
   │   └──────────────────────────────────────────────────────┘     │
   │                                                                │
   │   ┌─────────────────────────┐  ┌─────────────────────────┐     │
   │   │ medusa-server           │  │ medusa-worker           │     │
   │   │  - Dockerfile (shared)  │  │  - Dockerfile (shared)  │     │
   │   │  - WORKER_MODE=server   │  │  - WORKER_MODE=worker   │     │
   │   │  - port 9000 (internal) │  │  - no public port       │     │
   │   │  - runs predeploy:force │  │                         │     │
   │   └────────────┬────────────┘  └────────────┬────────────┘     │
   │                │                            │                  │
   │                └──────────────┬─────────────┘                  │
   │                               ▼                                │
   │                ┌─────────────────────────────┐                 │
   │                │ valkey 8  (alpine)          │                 │
   │                │  - --appendonly yes (AOF)   │                 │
   │                │  - volume: valkey-data      │                 │
   │                └─────────────────────────────┘                 │
   │                                                                │
   │   Docker network: jyt-net   ─── all four services join here    │
   └────────────────────────────────┬───────────────────────────────┘
                                    │ TCP :5432 (sslmode=require)
                                    ▼
                          ┌────────────────────┐
                          │  Railway Postgres  │
                          └────────────────────┘

       Phase 2 (not in this plan):
       on-VM Valkey  ──── replicates to ────▶  ElastiCache Serverless Valkey (us-east-1 VPC)
```

### 3.1 Components

| Service | Image | Job | Ports |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | TLS termination, reverse proxy | 80, 443 (host) |
| `medusa-server` | built from `apps/backend/Dockerfile`, `MEDUSA_WORKER_MODE=server` | Express API + admin UI | 9000 (internal only) |
| `medusa-worker` | same image, `MEDUSA_WORKER_MODE=worker` | Subscribers, jobs, workflow engine | none |
| `valkey` | `valkey/valkey:8-alpine` | Cache + event bus + workflow state | 6379 (internal only) |

### 3.2 What we are NOT doing in Phase 1

- ❌ Managed cache. Valkey runs as a container next to Medusa.
- ❌ HA across multiple VMs. Single box = single point of failure. Snapshots + fast restore is the recovery story.
- ❌ Multi-region. Single us-east-1 box. Atlantic users will eat latency until / unless we add a region.
- ❌ Auto-scaling. Static box. If we outgrow it, we vertically scale (resize) or move to App Runner / CF Containers.
- ❌ CI-driven deploys. Manual SSH for now. Add GitHub Actions in Phase 2.
- ❌ The on-VM ↔ ElastiCache replication. Designed and provisioned in Phase 2.

## 4. New files to add

```
deploy/aws/
├── PLAN.md              ← this file
├── README.md            ← runbook: provision, first deploy, debug, rollback
├── docker-compose.yml   ← server + worker + valkey + caddy
├── Caddyfile            ← reverse proxy + auto-TLS
├── .env.example         ← every env var, no values
└── setup.sh             ← idempotent bootstrap script for a fresh Lightsail box
```

**No backend code changes.** `apps/backend/Dockerfile` is reused as-is.

### 4.1 `docker-compose.yml` (sketch — for review)

```yaml
name: jyt-medusa

services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [medusa-server]
    networks: [jyt-net]

  medusa-server:
    image: ghcr.io/jaal-yantra-textiles/v2:latest   # same image Railway uses
    restart: unless-stopped
    env_file: .env
    environment:
      MEDUSA_WORKER_MODE: server
      REDIS_URL: redis://valkey:6379
    depends_on: [valkey]
    networks: [jyt-net]
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:9000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s

  medusa-worker:
    image: ghcr.io/jaal-yantra-textiles/v2:latest   # identical image, different MEDUSA_WORKER_MODE
    restart: unless-stopped
    env_file: .env
    environment:
      MEDUSA_WORKER_MODE: worker
      REDIS_URL: redis://valkey:6379
      DISABLE_MEDUSA_ADMIN: "true"
    depends_on: [valkey, medusa-server]   # server runs migrations first
    networks: [jyt-net]

  valkey:
    image: valkey/valkey:8-alpine
    restart: unless-stopped
    command: ["valkey-server", "--appendonly", "yes", "--save", "60", "1000"]
    volumes:
      - valkey-data:/data
    networks: [jyt-net]

volumes:
  caddy-data:
  caddy-config:
  valkey-data:

networks:
  jyt-net:
```

### 4.2 `Caddyfile` (sketch)

```caddy
{
  email saranshforgpay@gmail.com
}

v3.jaalyantra.com {
  reverse_proxy medusa-server:9000

  encode zstd gzip
  request_body {
    max_size 50MB        # file uploads via the admin go through here
  }

  log {
    output stdout
    format json
  }
}
```

Caddy issues + renews a real Let's Encrypt cert automatically. Cloudflare sits in front in "Full (Strict)" mode → TLS to the origin is real, no cert mismatch.

### 4.3 `.env.example` (sketch)

Mirrors `apps/backend/.env.railway.server` plus the new R2 vars, minus any
Railway-template references (`${{...}}`) which become real values here.

```sh
NODE_ENV=production
PORT=9000

# Connection strings
DATABASE_URL=postgres://...@railway.../db?sslmode=require
# REDIS_URL set in docker-compose (redis://valkey:6379) — no need here

# Auth
JWT_SECRET=
COOKIE_SECRET=

# CORS
STORE_CORS=
ADMIN_CORS=
AUTH_CORS=

# Public URLs
MEDUSA_BACKEND_URL=https://v3.jaalyantra.com   # same as today on Railway

# R2 (file uploads)
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=
S3_ENDPOINT=
S3_FILE_URL=

# Optional integrations (only set if live in production)
# STRIPE_API_KEY=
# STRIPE_WEBHOOK_SECRET=
# RESEND_API_KEY=
# ... (see medusa-config.prod.ts for the full surface)
```

### 4.4 `setup.sh` (sketch)

Idempotent bootstrap for a fresh Lightsail Ubuntu 22.04 instance. Run with
`bash setup.sh`. Steps:

1. `apt-get update && upgrade`
2. Install Docker Engine + compose plugin from official Docker repo (not the
   distro `docker.io` package — too old).
3. Add the `ubuntu` user to the `docker` group.
4. Configure UFW: allow 22 (from your IP only ideally), 80, 443; deny rest.
5. Clone the repo (or rsync from your laptop).
6. Prompt for `.env` values (or just nudge to copy from `.env.example`).
7. `docker compose build && docker compose up -d`.
8. `docker compose logs --tail=50 -f` to confirm boot.

## 4.5 GHCR auth

The image `ghcr.io/jaal-yantra-textiles/v2:latest` may be **private**. The
Lightsail box needs `docker login ghcr.io` with a Personal Access Token (PAT)
that has `read:packages` scope. `setup.sh` will prompt for it on first run and
save credentials to `~/.docker/config.json`. Without this, the very first
`docker compose pull` fails with `unauthorized`.

If the image is public, we can drop this step — verify by checking the
package visibility at `github.com/orgs/Jaal-Yantra-Textiles/packages`.

## 5. Lightsail provisioning checklist (user-owned)

1. **Lightsail dashboard → Create instance**
   - Region: `us-east-1` (closest to ElastiCache + reasonable for global)
   - Blueprint: **OS Only → Ubuntu 22.04 LTS**
   - Plan: **$40/mo (4 GB RAM, 2 vCPU, 80 GB SSD, 4 TB transfer)**
   - **Pick us-east-1**: Railway PG lives in us-east4 (Ashburn). us-east-1 (Virginia) puts you ~5ms from PG. This is actually *better* than your current Railway compute, which sits in us-west2 and crosses the country to reach PG.
   - SSH key: upload your public key, or use the auto-generated one
   - Name: `jyt-medusa-prod`
2. **Static IP**: Networking → Static IPs → Create. Attach to the instance. Free as long as attached.
3. **Firewall** (Lightsail's UI, not iptables): allow 22 (your IP only), 80 (anywhere), 443 (anywhere). Deny rest.
4. **DNS cutover**: Cloudflare → `jaalyantra.com` zone → find the existing `v3` A/CNAME record currently pointing at Railway → change it to point at the Lightsail static IP. Start in **DNS-only mode (grey cloud)** so Caddy can complete the Let's Encrypt HTTP-01 challenge.
5. **After Caddy has a cert**: flip CF to **proxied (orange cloud)** + SSL/TLS mode **Full (Strict)**. End-to-end encryption: client ↔ CF (CF cert) and CF ↔ origin (LE cert).

## 6. First deploy flow

```bash
# From your laptop, SSH in:
ssh ubuntu@<static-ip>

# On the box:
git clone https://github.com/Jaal-Yantra-Textiles/jyt.git
cd jyt/deploy/aws
bash setup.sh

# When setup.sh prompts:
cp .env.example .env
nano .env   # fill in all secrets

# Pull the same image Railway runs + start:
docker login ghcr.io      # if image is private; PAT with read:packages scope
docker compose pull
docker compose up -d

# Watch boot:
docker compose logs -f
```

First boot:
1. Pull `ghcr.io/jaal-yantra-textiles/v2:latest` (~30 s).
2. `medusa-server` container starts → `predeploy:force` runs migrations.
3. Once server is healthy, `medusa-worker` starts.
4. Caddy obtains a Let's Encrypt cert (needs port 80 reachable + DNS pointing here, with CF in grey-cloud mode).
5. Hit `https://v3.jaalyantra.com/health` to verify (CF still grey-cloud at this point).
6. Once verified, flip CF to orange-cloud + Full (Strict). Re-test.

## 7. Observability

Phase 1 = "logs via SSH":

```bash
docker compose logs -f                  # everything, live
docker compose logs -f medusa-server    # server only
docker compose logs -f medusa-worker    # worker only
docker compose logs -f caddy            # TLS + access logs
docker stats                            # CPU/memory live
```

Phase 2 ideas (not in scope now):
- Ship logs to CloudWatch or a third-party (Better Stack, Axiom, Datadog).
- Sentry integration if we decide to add it.

## 8. Backup / restore strategy

| What | How | Frequency |
|---|---|---|
| App code | git | always (no backup needed) |
| Postgres | Railway's snapshots | per Railway plan |
| Valkey state | docker volume `valkey-data` (AOF + RDB) + Lightsail snapshot | AOF: continuous. Snapshot: daily auto. |
| Uploads | R2 bucket — durable by design | n/a |
| `.env` | NOT in git — keep a copy in a password manager | manual |
| Lightsail snapshot | Whole-disk snapshot of the VM | daily auto ($2/mo) |

**Restore drill** (do this once, before going live, against a throwaway box):
1. Provision a new Lightsail instance from the most recent snapshot.
2. Reattach the static IP (DNS already points there — propagation is instant).
3. `docker compose up -d` — services restart with the AOF state.
4. Wait for Caddy to re-issue cert (Let's Encrypt has caching, usually fast).
5. Hit `/health` to verify.

## 9. Rollback

App-level rollback when a deploy is bad:

```bash
ssh ubuntu@<static-ip>
cd jyt
git fetch && git checkout <last_good_sha>
cd deploy/aws
docker compose build && docker compose up -d
```

~5 minutes. If the bad deploy corrupted data, restore from a Lightsail
snapshot from before the deploy.

## 10. Known risks

1. **Single point of failure.** One box = downtime if it dies. Mitigated by Lightsail snapshots + fast restore (~10 min recovery). Acceptable for early prod, becomes a Phase 2 concern.
2. **Memory pressure: resolved at 4 GB.** Realistic budget: server ~600 MB, worker ~400 MB, Valkey ~150 MB (can grow with data), Caddy ~30 MB, OS ~300 MB. That's ~1.5 GB used, ~2.5 GB headroom. Swap is no longer needed as insurance — drop the swapfile step from Phase 2. Headroom also means we can run a temporary `medusa db:migrate` job or one-off scripts without OOM risk.
3. **Caddy → CF Full (Strict) requires real cert from LE.** First boot: port 80 must be open AND DNS must already point at the box, OR Caddy fails to obtain a cert. Order of operations matters in §5–6.
4. **Railway PG latency from us-east-1.** Confirmed: Railway PG is in `us-east4` (Ashburn, VA). Lightsail in us-east-1 puts you ~5 ms from PG. This is *better* than your current Railway compute setup (which lives in us-west2 and crosses the country to reach PG).
5. **Disk fills up.** Docker images + Valkey AOF + Caddy logs grow. Set up log rotation in `setup.sh` (docker logging driver, max-size + max-file) and a `docker system prune` cron.
6. **Lightsail egress is capped.** 3 TB/mo on the $20 plan. Should be plenty for an API backend (uploads go to R2, not through the VM).

## 11. Phased rollout

### Phase 0 — this plan
- [ ] User reviews PLAN.md
- [ ] Resolve §2 open questions (hostname, SSH key, R2 names, backup cadence)
- [ ] Mark plan approved

### Phase 1 — single VM in production
- [ ] Provision Lightsail instance (us-east-1, 4 GB) + static IP + firewall
- [ ] Provision R2 bucket + API token
- [ ] Confirm GHCR image visibility (public vs. private + PAT needed)
- [ ] Pull real env values from Railway dashboard → local file
- [ ] Run `setup.sh` on the box (installs Docker, `docker login ghcr.io`, prompts for `.env`)
- [ ] Bring up `docker compose` with CF DNS still pointing at Railway — verify on workers.dev-style URL or raw static IP via `curl --resolve`
- [ ] Smoke test: `/health`, place a test order, verify a job runs
- [ ] Storefront integration tests against the staged endpoint
- [ ] Restore drill (provision throwaway from snapshot)
- [ ] Swap CF DNS for `v3.jaalyantra.com` to Lightsail static IP (grey cloud first, flip to orange after Caddy gets a cert)
- [ ] Decom Railway `medusa-server` and `medusa-worker` services (keep Railway PG + Redis until verified, then kill Redis)

### Phase 2 — hardening
- [ ] GitHub Actions deploy on `main` merge (SSH + `docker compose pull` flow)
- [ ] Log shipping to CloudWatch or Better Stack
- [ ] Wire on-VM Valkey → ElastiCache replication (separate doc)
- [ ] Set up basic uptime monitoring (Better Stack / UptimeRobot)

### Phase 3 — scale, if/when needed
- [ ] Vertical resize (Lightsail 4 GB / 8 GB) if RAM pressure
- [ ] Reconsider CF Containers or App Runner once we have real traffic data
- [ ] Move PG off Railway if latency or cost becomes a problem

## 12. Cost summary

| Item | Monthly |
|---|---|
| Lightsail 4 GB instance | $40 |
| Static IP (attached) | $0 |
| Snapshots (daily, ~10 retained) | ~$4 |
| ElastiCache Serverless (kept for future replication) | ~$70 (idle floor) |
| R2 (storage + ops) | <$5 at our scale |
| Cloudflare (DNS/CDN/WAF) | $0 |
| Railway PG | (unchanged) |
| **New AWS spend** | **~$44 + $70 ElastiCache** |

Note: the ElastiCache idle floor is the meaningful cost line. If the
replication plan slips beyond a month or two, revisit whether to keep it
running. Re-creating Serverless Valkey takes 5 minutes.
