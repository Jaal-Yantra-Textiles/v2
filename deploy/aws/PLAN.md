# AWS ECS Fargate deployment plan — JYT backend

> Status: **DRAFT — review before any code lands.**
> Date: 2026-05-18
> Owner: Saransh
> Target: deploy the Medusa 2.x backend (`apps/backend`) on AWS ECS Fargate
> (us-east-1) with auto-scaling, behind an ALB and Cloudflare. ElastiCache
> Serverless Valkey via VPC connector. Railway PG unchanged. R2 for files.
> Phase 0 ships JYT as tenant #1; Phase 1+ extends to multi-tenant SaaS.

## Why Fargate (vs the paths we explored)

| Option | Why not now |
|---|---|
| Lightsail Instance | No auto-scaling. Static VM. Wrong primitive for a future multi-tenant platform. *Mothballed: `PLAN-lightsail-instance.md`.* |
| Cloudflare Containers | Can't reach ElastiCache privately. Per-tenant primitives less mature. *Mothballed: `../cloudflare/PLAN.md`.* |
| AWS App Runner | 10-service soft limit per account — fine for JYT alone, breaks the platform pattern. |
| AWS EKS | Too much operational weight for one tenant today. Re-evaluate at Phase 2+ when tenant count justifies K8s. |
| **AWS ECS Fargate** | **Picked.** Auto-scales per service, native VPC = ElastiCache works, AWS SDK `RunTask`/`CreateService` is the right primitive for future tenant provisioning. Manageable for one tenant; scales to N. |

---

## 1. Phase 0 scope (what this plan covers)

Deploy **JYT itself** as the only tenant on the new infra. Everything below is Phase 0 unless explicitly tagged Phase 1+.

**Out of scope here**:
- Multi-tenant data layer (Phase 1)
- Tenant provisioning automation (Phase 2)
- Customer-facing UI + billing (Phase 3)
- Per-tenant domain + on-demand TLS (Phase 2/3)

Phase 0 success = `v3.jaalyantra.com` is served from Fargate, Railway compute is decommissioned, the auto-scaling works under synthetic load, and the deploy pipeline is idempotent.

## 2. Decisions locked

| Decision | Choice | Why |
|---|---|---|
| Compute | **ECS Fargate**, us-east-1 | Serverless containers, auto-scaling, talks to ElastiCache privately. |
| Tooling | **AWS Copilot CLI** for Phase 0; evaluate AWS CDK at Phase 1+ | Copilot generates VPC + ALB + ECS service + IAM in one command. CDK becomes worth it once we need fine-grained programmatic infra for the platform. |
| Auto-scaling target | **CPU 60%** + **memory 75%**, min 1 / max 5 tasks | Mirrors Railway's "up to 5 replicas." Tune after observing real traffic. |
| Server task size | **0.5 vCPU / 1 GB** per task, regular Fargate | Cost-optimized starting point. Medusa server steady-state is ~600 MB; 1 GB is tight but workable. Scale up if metrics demand. Regular (not Spot) — user-facing, can't tolerate 2-min interruption. |
| Worker task size | **0.5 vCPU / 1 GB**, fixed at 1 task, **Fargate Spot** | Worker is restartable and idempotent. Spot is safe and saves ~70%. ~$5/mo vs $18/mo on regular Fargate. |
| Network | VPC with **default Copilot topology**: 2 public + 2 private subnets across us-east-1a/1b, with NAT Gateways | Resolved 2026-05-18: our public-only manifest conflicted with `env init`'s default config. Accepting the ~$32/mo NAT cost to unblock; revisit in Phase 1 to drop NAT and migrate tasks to public-subnet placement. |
| Load balancer | **Application Load Balancer (ALB)** with ACM cert | HTTPS termination, path-based routing if we ever need it. |
| Cert | **AWS Certificate Manager** for `v3.jaalyantra.com` | Free, auto-renewed. |
| CF posture | **DNS proxied (orange cloud)**, SSL Full (Strict) | WAF + DDoS + cache at edge. ALB has real cert from ACM = Full Strict works end-to-end. |
| Image source | **ECR**, mirrored from `ghcr.io/jaal-yantra-textiles/v2:latest` via GitHub Actions | ECS task execution role auths to ECR natively. No PAT to rotate. |
| Postgres | **Railway PG, unchanged** | us-east4 → us-east-1 is ~5 ms. No migration. |
| Redis / cache | **ElastiCache Serverless Valkey** (existing cluster `jyt-spaces-1ufoes`, us-east-1) — **keep, don't delete** | Updated 2026-05-18 after re-checking pricing. AWS dropped the minimum data-storage charge for Valkey Serverless from 1 GB to **100 MB**. At our actual usage (~151 MB stored, ~40 MB/mo traffic) the real cost is **~$9.30/mo**, not the $70 I originally quoted. Cheaper than provisioned `cache.t4g.micro` ($11) AND auto-scales for the multi-tenant Phase 1+ future AND multi-AZ HA by default. Clear win. |
| File storage | **Cloudflare R2** via `@medusajs/file-s3` | Free egress, S3-compatible. (Could be S3 instead — using AWS credits — but R2 is locked in and works.) |
| Secrets | **AWS Secrets Manager** for genuinely-rotating values (DB creds, third-party API keys); **SSM Parameter Store** for everything else (CORS strings, public URLs, feature flags) | SSM is free up to 10k params, native ECS integration. Only pay Secrets Manager's $0.40/secret/mo for things that actually rotate — typically 5–8 secrets, not 20. |
| Logs | **CloudWatch Logs**, **14-day retention** | Native, free up to 5 GB ingest/mo. Retention default is "never expire" → costs grow forever; 14 days is plenty for Phase 0 debugging. |
| ECR | **Lifecycle policy: keep last 5 image versions** | Free policy, prevents indefinite storage growth. |
| Observability | **Sentry Developer (free) tier** | 5k errors + 100k traces/mo. Plenty for Phase 0. Upgrade to Team ($26/mo) if we burn through it. Add `SENTRY_DSN` to env. |
| CI/CD | **GitHub Actions** on push to `main` → mirror GHCR → ECR → `copilot svc deploy` | Drafted by Claude as part of Phase 0. Uses AWS OIDC role (no long-lived access keys). |
| Migrations | **Server task runs `predeploy:force` on boot** (unchanged) | MikroORM advisory lock makes it restart-safe across scaled instances. |
| Hostname | **`v3.jaalyantra.com`** | Same as today. DNS swap only. |

## 3. Decisions resolved 2026-05-18

1. ✅ **AWS credits**: **$1,000**, expires next year. At the optimized ~$64/mo Phase 0 spend, that's ~15 months of runway on credits alone.
2. ✅ **CF credits**: **$5,000**, applies to all CF products, expires next year. R2 fully covered. Plenty of headroom for Workers/Pages/CF Containers if we revive that path.
3. ✅ **CI/CD**: Claude drafts GitHub Actions workflow as part of Phase 0.
4. ✅ **Staging**: prod-only for Phase 0 (Railway is de facto staging). Real staging env in Phase 1.
5. ✅ **Sentry**: yes — Developer (free) tier in Phase 0.

No open decisions blocking Phase 0 implementation.

## 4. Architecture

```
                ┌──────────────────────────────────────────┐
                │  Cloudflare  (proxied, Full Strict TLS)  │
                │  v3.jaalyantra.com  →  ALB DNS           │
                └──────────────────┬───────────────────────┘
                                   │ HTTPS
                                   ▼
                ┌──────────────────────────────────────────┐
                │  AWS ECS Fargate cluster (us-east-1)     │
                │  ─── VPC: jyt-prod-vpc ───               │
                │                                          │
                │  ┌────────────────────────────────────┐  │
                │  │ Application Load Balancer (ALB)    │  │
                │  │  - HTTPS :443 (ACM cert)           │  │
                │  │  - target group → medusa-server    │  │
                │  └──────────┬─────────────────────────┘  │
                │             │                            │
                │   ┌─────────▼──────────────────────┐     │
                │   │ Service: medusa-server         │     │
                │   │   task: 1 vCPU / 2 GB          │     │
                │   │   desired: 1, min 1, max 5     │     │
                │   │   autoscale on CPU 60% / mem 75%│    │
                │   │   public subnet, SG-restricted │     │
                │   │   image: ECR/jyt-medusa:<sha>  │     │
                │   │   env: MEDUSA_WORKER_MODE=server│    │
                │   └──────────┬─────────────────────┘     │
                │              │                           │
                │   ┌──────────▼──────────────────────┐    │
                │   │ Service: medusa-worker          │    │
                │   │   task: 0.5 vCPU / 1 GB         │    │
                │   │   desired: 1, fixed (no scale)  │    │
                │   │   no ALB (no inbound HTTP)      │    │
                │   │   image: ECR/jyt-medusa:<sha>   │    │
                │   │   env: MEDUSA_WORKER_MODE=worker│    │
                │   └──────────┬──────────────────────┘    │
                │              │                           │
                │              ▼ (VPC-internal)            │
                │   ┌─────────────────────────────────┐    │
                │   │ ElastiCache Serverless Valkey   │    │
                │   │ jyt-spaces-1ufoes.serverless... │    │
                │   │ private DNS, no public exposure │    │
                │   └─────────────────────────────────┘    │
                └──────────────────┬───────────────────────┘
                                   │ public TCP, sslmode=require
                                   ▼
                       ┌──────────────────────┐
                       │  Railway Postgres    │
                       │  pgvector/pg16       │
                       │  us-east4 (~5ms)     │
                       └──────────────────────┘

      Future Phase 1+: tenant_id-aware Medusa modules, or per-tenant
      Fargate services provisioned by an admin API. Both lay on top
      of this primitive without re-architecting.
```

## 5. AWS components to provision

Copilot will create most of these for us. Listing for transparency / cost tracking.

| Component | Created by | Cost (approx) |
|---|---|---|
| VPC + 2 public + 2 private subnets + IGW + 2 NAT Gateways | Copilot `app init` + `env init` + `env deploy` | ~$32/mo (NAT) |
| ALB (always-on) | Copilot `svc init --svc-type "Load Balanced Web Service"` | ~$22/mo + per-LCU |
| ECS Cluster (Fargate) | Copilot `env init` | $0 |
| ECR repository `jyt-medusa` + lifecycle policy | Manual: `aws ecr create-repository` + `put-lifecycle-policy` | <$1/mo with 5-image retention |
| ACM certificate for v3.jaalyantra.com | Copilot or AWS console | $0 |
| Security groups (ALB, services, ElastiCache) | Copilot + manual SG rule for ElastiCache | $0 |
| ECS Service: `medusa-server` (0.5 vCPU + 1 GB, regular Fargate, 24/7) | Copilot `svc deploy` | ~$18/mo (single task; auto-scales 1→5) |
| ECS Service: `medusa-worker` (0.5 vCPU + 1 GB, **Fargate Spot**, 24/7) | Copilot `svc init --svc-type "Worker Service"` with Spot capacity provider | ~$5/mo |
| CloudWatch Logs (2 log groups, 14-day retention) | Auto by ECS | <$3/mo at our scale |
| SSM Parameter Store (most config) | Manual via CLI | $0 (free standard tier) |
| Secrets Manager (5–8 rotating secrets) | Manual via CLI | ~$3/mo |
| ElastiCache **Serverless Valkey** (existing cluster) | Already provisioned (`jyt-spaces-1ufoes`) | **~$9.30/mo** at current usage (151 MB storage + light traffic) |
| Sentry Developer | n/a | $0 |
| R2 (storage + ops) | CF dashboard | $0 (covered by CF credits) |

**Total approximate Phase 0 spend: ~$94/mo** (including 2× NAT Gateway at $32/mo). AWS credits ($1,000) ≈ 10–11 months runway before paying out of pocket. Phase 1 hardening can reclaim the $32 by switching to a public-subnet-only topology — flag in §12 Phase 1 work.

> **Pricing note (2026-05-18):** ElastiCache Serverless for Valkey now has a **100 MB minimum data storage charge** (down from 1 GB). At ~151 MB stored, you pay for the actual 151 MB, not a 1 GB floor. This makes Serverless *cheaper than provisioned* at our scale and keeps the auto-scale benefit for the multi-tenant future. Re-confirm pricing at `https://aws.amazon.com/elasticache/pricing/` before any major scale-up.

## 6. New files to add

```
deploy/aws/
├── PLAN.md                       ← this file (Fargate active)
├── PLAN-lightsail-instance.md    ← mothballed prior plan
├── copilot/                      ← Copilot CLI workspace
│   ├── .workspace                ← (generated)
│   ├── medusa-server/
│   │   └── manifest.yml          ← Load Balanced Web Service
│   ├── medusa-worker/
│   │   └── manifest.yml          ← Worker Service
│   └── environments/
│       └── prod/
│           └── manifest.yml      ← env-level config (VPC, region, certs)
├── scripts/
│   ├── ghcr-to-ecr.sh            ← Mirror an image tag from GHCR → ECR
│   └── seed-secrets.sh           ← Push secrets from local file → Secrets Manager
├── .github/workflows/
│   └── ecs-deploy.yml            ← Build/push to ECR, `copilot svc deploy`
├── secrets.example.env           ← Every env var, no values (template)
└── README.md                     ← Runbook
```

(`.github/workflows/` lives at repo root in practice — listed here for clarity.)

## 7. Deploy flow (Phase 0)

### One-time setup

```bash
# Install Copilot
brew install aws/tap/copilot-cli

# Configure AWS access
aws configure                      # or aws sso login if using SSO
aws ecr create-repository --repository-name jyt-medusa --region us-east-1

# Initialize Copilot app
cd deploy/aws
copilot app init jyt

# Create a prod environment
copilot env init --name prod --profile default --default-config
copilot env deploy --name prod

# Initialize services
copilot svc init \
  --name medusa-server \
  --svc-type "Load Balanced Web Service" \
  --dockerfile ../../apps/backend/Dockerfile

copilot svc init \
  --name medusa-worker \
  --svc-type "Worker Service" \
  --dockerfile ../../apps/backend/Dockerfile

# Seed secrets (from your local pull of Railway env)
bash scripts/seed-secrets.sh prod
```

### Each deploy

```bash
# Option A: build + push from local
copilot svc deploy --name medusa-server --env prod
copilot svc deploy --name medusa-worker --env prod

# Option B: pull pre-built image from GHCR → ECR, then point Copilot at the SHA
bash scripts/ghcr-to-ecr.sh latest    # mirrors GHCR latest to ECR with the digest
copilot svc deploy --name medusa-server --env prod --tag <ecr-sha>
copilot svc deploy --name medusa-worker --env prod --tag <ecr-sha>
```

Option B is the recommended path for prod — same image as Railway = identical behavior, no rebuild surprises.

## 8. Cutover from Railway (Phase 0 final step)

1. Deploy to Fargate, ALB live at `prod-xxx.us-east-1.elb.amazonaws.com`.
2. Smoke test against the ALB DNS directly (`curl --resolve` or `Host:` header).
3. Place a test order via the staging URL; verify a subscriber fires.
4. CF DNS: change `v3.jaalyantra.com` A record from Railway → ALB (use ALB's stable hostname via CF's CNAME flattening, or set as CNAME).
5. **Grey-cloud** first to verify, then orange-cloud once ALB cert is happy.
6. Watch CF + CloudWatch for 24h.
7. Decommission Railway `medusa-server` + `medusa-worker` services. **Keep Railway PG.** Optionally kill Railway Redis once Fargate's Valkey is verified.

## 9. Rollback

ECS keeps the previous task definition revision. To rollback:

```bash
copilot svc rollback --name medusa-server --env prod
```

~2 minutes. Or `copilot svc deploy --tag <previous-sha>` for an explicit older SHA. If a DB migration was destructive, restore Railway PG from its own snapshot.

## 10. Bridge to the platform vision (Phase 1+)

Phase 0 deploys JYT as a single tenant. Phase 1+ adds:

1. **Tenant data isolation.** Two paths to evaluate:
   - **Per-tenant schema in shared PG** — one PG cluster, many schemas. Cheaper, weaker isolation.
   - **Per-tenant DB on a Postgres-as-a-Service** — Neon or Crunchy with their tenant-DB primitives. Stronger isolation, more $.
2. **Per-tenant Fargate service.** Programmatic `aws ecs create-service` per signup. Auto-create:
   - One `medusa-server-<tenant>` service + ALB rule for `<tenant>.yourplatform.com`
   - One `medusa-worker-<tenant>` service
   - Per-tenant secrets in Secrets Manager
3. **On-demand TLS.** ACM via DNS validation + a Route 53 hosted zone the platform controls, OR CF for SaaS for customer custom domains.
4. **Billing.** Stripe Billing + per-tenant usage tracking via CloudWatch metrics.
5. **Admin UI.** A small Next.js app (separate codebase) that calls the AWS SDK on a customer's behalf.

None of this changes the Phase 0 primitives. Fargate, ECR, ALB, ElastiCache, Secrets Manager — all stay. We just programmatically create more of them.

## 11. Known risks

1. **NAT-less public subnets.** Tasks have public IPs. SGs must lock down inbound to the ALB only. If a SG rule slips, tasks are exposed to the internet. Mitigation: ALB-only ingress rule on the task SG, verified before going live.
2. **ALB cost.** ~$22/mo even at zero traffic. With multiple tenants in Phase 1+, we either share the ALB (path-based routing) or pay per-tenant ALB. Worth designing for path-based sharing now.
3. **Auto-scaling cold start.** Spinning a new task from 0→ready takes ~30–60s (image pull + Medusa boot). Min=1 prevents zero-scale; bursts beyond capacity will be slow until the new task is hot.
4. **GHCR private image auth.** If the GHCR image is private and we don't mirror to ECR, ECS can't pull. Mirroring to ECR is the recommended path; skipping it means storing a PAT in Secrets Manager.
5. **ElastiCache Serverless cost surprises.** Storage is $0.084/GB-hour and ECPUs are $0.0023/million. If a tenant accidentally caches multi-GB blobs or a runaway loop hammers Redis, the bill will move. Mitigation: CloudWatch alarm on `BytesUsedForCache` > 1 GB *or* `ECPUs` > 50M/day, with SNS → email to Saransh. Set up before going live.
6. **Single VPC for the platform.** Phase 1+ tenants share the VPC. If we ever need cross-tenant network isolation, that's a re-architecture. Probably fine for our scale.

## 12. Phased rollout

### Phase 0a — this plan
- [ ] User reviews PLAN.md
- [ ] Resolve §3 open questions (AWS credits, CF credits, CI ownership, staging Y/N, Sentry)
- [ ] Mark plan approved

### Phase 0b — Fargate-side provisioning (user-owned, ~30 min)
- [ ] Install Copilot CLI (`brew install aws/tap/copilot-cli`)
- [ ] **Keep** the existing ElastiCache Serverless cluster `jyt-spaces-1ufoes`. We'll add a SG inbound rule for Fargate after `copilot env deploy` creates the task SG.
- [ ] Set up CloudWatch alarms on `BytesUsedForCache` and `ElastiCacheProcessingUnits` (cost guardrails — see §11 risks)
- [ ] `aws ecr create-repository --repository-name jyt-medusa --region us-east-1`
- [ ] Apply ECR lifecycle policy (keep last 5 images)
- [ ] Verify GHCR image visibility — if private, prepare a PAT scoped to `read:packages` for the GHCR→ECR mirror step
- [ ] Pull real env values from Railway dashboard → local `secrets.env`
- [ ] Set up an AWS OIDC identity provider for GitHub Actions (for the CI workflow Claude drafts)
- [ ] Create a Sentry project, capture `SENTRY_DSN`
- [ ] Create R2 bucket + API token, capture S3-style credentials

### Phase 0c — Claude writes Copilot + scripts + CI (~few hours)
- [ ] `copilot/medusa-server/manifest.yml` (Load Balanced Web Service, 0.5 vCPU/1 GB, auto-scale 1→5)
- [ ] `copilot/medusa-worker/manifest.yml` (Worker Service, Fargate Spot, 0.5 vCPU/1 GB, 1 task fixed)
- [ ] `copilot/environments/prod/manifest.yml` (us-east-1, public subnets for Phase 0, ACM cert)
- [ ] `deploy/aws/scripts/ghcr-to-ecr.sh` (mirror a GHCR tag → ECR with digest)
- [ ] `deploy/aws/scripts/seed-secrets.sh` (push values from a local file → Secrets Manager + SSM)
- [ ] `.github/workflows/ecs-deploy.yml` (on push to main: mirror image, deploy server, deploy worker)
- [ ] `deploy/aws/secrets.example.env` (template)
- [ ] `deploy/aws/README.md` (runbook)

### Phase 0d — first deploy + cutover
- [ ] `copilot app init jyt` from repo root
- [ ] `copilot env init --name prod`
- [ ] `copilot env deploy --name prod`
- [ ] `copilot svc init` for both services
- [ ] `bash deploy/aws/scripts/seed-secrets.sh prod`
- [ ] `bash deploy/aws/scripts/ghcr-to-ecr.sh latest` (mirror image)
- [ ] `copilot svc deploy --name medusa-server --env prod`
- [ ] `copilot svc deploy --name medusa-worker --env prod`
- [ ] Add ElastiCache SG inbound rule allowing Fargate task SG on :6379
- [ ] Smoke test against ALB DNS (curl --resolve)
- [ ] Verify Valkey connectivity from a server task (Copilot `svc exec`)
- [ ] Storefront integration tests against ALB
- [ ] CF DNS: swap `v3.jaalyantra.com` A/CNAME → ALB, grey cloud first
- [ ] Once Caddy-free path verified (ALB has ACM cert), flip CF orange-cloud + Full (Strict)
- [ ] 24h watch, then decom Railway compute services (keep Railway PG)

### Phase 0c — cutover
- [ ] R2 bucket + API token (if not done)
- [ ] CF DNS swap to ALB (grey cloud first)
- [ ] Verify 24h
- [ ] Flip CF orange-cloud + Full (Strict)
- [ ] Decom Railway compute services (keep Railway PG)
- [ ] Restore drill (verify rollback path works)

### Phase 1 — platform foundations
- [ ] Design doc: tenant data isolation strategy
- [ ] Drop NAT Gateways → switch task placement to public subnets (saves ~$32/mo). Either recreate the env with custom CIDRs across matching AZs, or evaluate Copilot's `private: []` syntax.
- [ ] Sentry / observability hardening (alerts, dashboards, performance traces)
- [ ] GitHub Actions for CI deploys (no more local `copilot svc deploy`)
- [ ] Staging environment

### Phase 2 — multi-tenant provisioning
- [ ] Admin API: `POST /tenants` → spins up Fargate service + secrets + DB schema
- [ ] On-demand TLS for tenant domains
- [ ] Per-tenant CloudWatch dashboards

### Phase 3 — go-to-market
- [ ] Stripe Billing wiring
- [ ] Customer UI (signup, billing, instance management)
- [ ] Pricing tiers (shared = Phase X / dedicated = today's pattern)
- [ ] First external customer onboarded
