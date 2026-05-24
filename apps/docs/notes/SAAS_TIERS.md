# JYT SaaS Tiers — Shared vs Dedicated

> Status: **DRAFT** — captures the tier decision so we don't lose it while we focus on shared-tier hardening.
> Date: 2026-05-24
> Owner: Saransh
> Companion to `deploy/aws/PLAN.md` (Phase 0 deploy infrastructure).

## TL;DR

JYT is becoming a multi-tenant Medusa SaaS with **two tiers**:

- **Shared (Starter)** — every partner is a row in one Medusa instance. Per-partner data isolation via `partner_*` links and clone-on-write on shared core rows (regions, tax_regions). Cheapest, fastest to onboard.
- **Dedicated (Pro)** — each Pro partner gets their own ECS service + their own Postgres schema (or own RDS) + their own publishable key + optional custom domain. True noisy-neighbor isolation. Higher fixed cost.

Both tiers expose the **same partner-facing API surface** (`/partners/...`). The Pro tenant's UI is identical to the Starter partner UI. The backend just behaves "as if there's only one partner" inside a Pro instance, and the per-partner safety code becomes a no-op.

---

## Tier comparison

| | Shared (Starter) | Dedicated (Pro) |
|---|---|---|
| Compute | One ECS service `jyt-prod-medusa-server`, all partners share | One ECS service per tenant in `jyt-saas-prod` cluster |
| Database | One RDS, one schema (`public`), partner data isolated via link tables | One Postgres **schema per tenant** in shared RDS (MVP) → own RDS instance (true isolation upsell) |
| Cache | Shared ElastiCache Valkey, no key namespacing today | Shared Valkey with `tenant_<id>:` key prefix per tenant |
| Storefront | All on `*.partner.jyt-saas.com` subdomains | `api.<custom-domain>` per tenant via ALB host rules + ACM cert |
| Worker | One shared `medusa-worker` ECS service | Per-tenant worker ECS service (cost doubler) **or** shared worker polling tenant DBs (complex; deferred) |
| Custom payment credentials | Not in v1 (shared provider config) | Per-tenant secrets in AWS Secrets Manager |
| Migrations | One `db:migrate` covers all partners | Per-tenant migration pipeline, blue-green rollout |
| Backups | One RDS snapshot covers all | Per-tenant logical dumps or per-schema snapshots |
| Cost floor per tenant | ~$0–10/mo (amortised) | ~$30–40/mo (shared RDS schema) → ~$80–100/mo (own RDS) |
| Boot time impact | None for new tenants — instant onboard | 240s ECS warmup per tenant; can't scale to zero |

## Cloudflare's role across both tiers

| | Shared | Dedicated |
|---|---|---|
| DNS | Cloudflare DNS for `*.partner.jyt-saas.com` and `v3.jaalyantra.com` (today) | Cloudflare DNS for `api.<tenant>` — automated via CF API when tenant onboards |
| Edge proxy | Orange-cloud on for WAF + DDoS + cache | Same |
| Storefront hosting | Vercel + storefront-starter (per partner already today) | Same — Vercel project per Pro tenant, provisioned alongside backend |
| R2 file storage | Shared bucket, per-partner prefixes | Per-tenant bucket OR shared with prefix (cost-driven choice) |
| **CF Containers** | **Not used** — mothballed in Phase 0 (Hyperdrive ↔ ElastiCache gap). Documented at `deploy/cloudflare/PLAN.md`. |

## The partner-API tier-agnostic contract

The single most important design principle of this plan:

> **Every partner-side feature must work identically in both tiers.**

In practice this means:
- Routes live under `/partners/...` regardless of tier.
- Per-partner safety code (clone-on-write, ownership checks, partner-region scoping) **degrades cleanly to no-op** when there's only one partner in the DB.
- Partner UI ships as one bundle; it doesn't know whether it's pointing at a shared backend or a dedicated one.
- New "core module per partner" routes (regions, tax-regions, sales-channels, shipping-options, etc.) all follow the same pattern: read via `partner_*` link, write with ownership+clone semantics.

This is what unlocks the upgrade path: a Starter partner who upgrades to Pro gets their data ported to a new dedicated instance, but the UI/UX and integrations don't change.

---

## Shared-tier hardening (current focus)

The shared tier needs per-partner safety on every core module a partner can touch. PR #257's lockdown was the first attempt; we reversed that direction in favour of **extend + harden**:

| Core module | Partner API status | Hardening still needed |
|---|---|---|
| Region | CRUD exists | country+currency match, clone-on-write on update, ref-counted delete, drop default fallback |
| Tax Region | CRUD exists but no ownership check on update/delete | **Add `partner_tax_region` link**, ownership check on every verb, clone-on-write, ref-counted delete |
| Shipping Option | CRUD exists | Verify scope via partner's `stock_location` chain; cascade fix when region cloned |
| Sales Channel | CRUD exists | Scope by partner→store; lock down cross-partner access |
| Fulfillment Set / Location | Wired through partner store | Verify scope; no shared-row hazard today |
| Payment Provider | List-only via region | Add `GET /partners/stores/:id/payment-providers` for discovery |

This list will become PRs over time — track in memory rather than here so the doc doesn't rot.

---

## Dedicated-tier engineering (deferred, scoped here)

What needs to exist before a single Pro tenant can be onboarded end-to-end:

### 1. Tenant provisioning workflow

A Mastra workflow `provisionDedicatedTenant({ name, plan, custom_domain? })` that:

1. Generates secrets (JWT, cookie, admin password) → AWS Secrets Manager
2. Creates Postgres schema OR new RDS instance — depends on tier sub-level
3. Sets up CloudFront/CF DNS for `api.<custom-domain>` if provided
4. Requests ACM cert + waits for issuance
5. Adds ALB listener rule routing `Host: api.<domain>` → new target group
6. Calls `ecs:CreateService` with: same image, tenant-scoped env vars (`DATABASE_URL`, `REDIS_URL`, etc.), 0.5 vCPU / 1 GB / count=1
7. Waits for healthcheck pass (240s grace period)
8. Runs `medusa db:migrate` and seeds: admin user, default region, publishable key
9. Provisions storefront Vercel project (reuses existing `provisionStorefrontWorkflow` from `apps/backend/src/workflows/stores/provision-storefront.ts`)
10. Emits `tenant.provisioned` event for billing/notification subscribers

### 2. Tenant control plane (admin-only)

New `/admin/saas/tenants/*` routes for Saransh as the platform operator:

| Route | Purpose |
|---|---|
| `POST /admin/saas/tenants` | Trigger provision workflow |
| `GET /admin/saas/tenants` | List with status (ECS service health, DB size, last deploy) |
| `GET /admin/saas/tenants/:id` | Detail view |
| `POST /admin/saas/tenants/:id/pause` | `ecs update-service --desired-count 0` |
| `POST /admin/saas/tenants/:id/resume` | `ecs update-service --desired-count 1` |
| `POST /admin/saas/tenants/:id/upgrade` | Bump image tag, trigger blue-green deploy |
| `POST /admin/saas/tenants/:id/snapshot` | RDS schema dump → S3 |
| `DELETE /admin/saas/tenants/:id` | Soft-delete: set `archived_at`; hard-delete after retention period |

### 3. Per-tenant migration pipeline

Today: one `medusa db:migrate` on `predeploy:force` boot.

Future: when shipping a new image to N Pro tenants, need to:
- Roll image update through ECS services one at a time (or in batches by tenant size)
- Each tenant's boot runs its own migrations against its own schema
- Failure of one tenant doesn't block the rest
- Per-tenant rollback playbook

Likely implementation: GitHub Actions matrix job, one cell per tenant, with circuit-breaker on N failures.

### 4. Tenant billing

Stripe metered billing keyed on:
- Compute hours (ECS task uptime via CloudWatch metrics)
- DB storage (CloudWatch RDS metrics, prorated for schema-per-tenant case)
- Request volume (CloudWatch ALB metrics filtered by tenant target group)

Owned by a Mastra cron that aggregates and pushes usage to Stripe weekly. Out of scope until first Pro tenant is real.

### 5. Operational constraints (carried forward from `reference_aws_ecs_medusa_gotchas`)

- 240s grace_period on ALB healthcheck — applies to every tenant
- `max_connections` on shared RDS must accommodate every tenant's connection pool: `tenants × tenant_pool_size × 1.2`. Bump custom parameter group as we add Pro tenants.
- Can't scale-to-zero — Medusa boot is 3–4 min cold; idle Pro tenants pay the floor.
- ALB listener rule limit (100 default, 500 raised) — each Pro custom domain = 1 rule. Past ~500 Pro tenants need listener sharding or NLB+SNI.

---

## Future scope (out of this doc, but flagged)

- **Visitor analytics offload to ClickHouse** — website visitor events are growing fast (`analytics_*` notes already exist in this folder); plan separately to move them off Postgres into ClickHouse, with a per-tenant database in the dedicated tier.
- **Visual workflow flow / builder** — `VISUAL_WORKFLOW_BUILDER_ARCHITECTURE.md` and related; tenant-facing workflow visualization is a Pro-tier upsell candidate.
- **Storefront-side region/catalog filtering** — the storefront's `/store/regions` returns all regions globally today; partner-side hardening doesn't fix this. Out of scope of the partner-API hardening PRs; separate work tracked in `feedback_partner_region_extend_not_lockdown.md` notes.

---

## Decision principle (anchor)

When you find yourself asking "should this go in the admin API or the partner API?":

- If it must work identically inside a Pro single-tenant deploy → **partner API**.
- If it's a platform-operator concern that only Saransh-as-vendor cares about → **admin API**.
- Never duplicate logic across both; either pick partner (and have Pro tenants use it themselves) or admin (and route Pro operator actions through the platform admin).
