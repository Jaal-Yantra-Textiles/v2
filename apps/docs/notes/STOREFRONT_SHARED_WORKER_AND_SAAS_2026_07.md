# Shared Multi-Tenant Storefront Worker + Cloudflare for SaaS

_Last updated: 2026-07-17 — supersedes nothing; complements
[`MULTI_ACCOUNT_HOSTING_PROVISIONING.md`](./MULTI_ACCOUNT_HOSTING_PROVISIONING.md)
and epic #1060._

## 1. Architecture

One **shared Cloudflare Worker** (`nextjs-starter-medusa`) serves **every** tenant.
There is no per-partner deploy in shared mode — the worker resolves the active
store **per request from the `Host` header** (`NEXT_PUBLIC_MULTI_TENANT=true` +
backend `/web/storefront/resolve`). "Provisioning" a partner in shared mode is
therefore just **attaching their domain**, never creating/deploying a project.

| Thing | Value |
|-------|-------|
| Cloudflare account | `c9b8b538ae53cd197539e3d1228e6dbe` (Saranshis@pm.me) |
| Zone | `cicilabel.com` → `ac80552084461805e37b7cb1313863cd` (Free plan) |
| Shared worker | `nextjs-starter-medusa` (workers.dev subdomain `saranshis`) |
| Vercel shared project | `storefront-shared` = `prj_0ilDYOzSHLhviU9OLnnvJl0b0BbJ` |
| Storefront repo | `Jaal-Yantra-Textiles/nextjs-starter-medusa` (submodule `apps/storefront-starter`) |
| Deployment account row | `dep_acct_01KXBSTJXS32PZ7CVCF3TA1DW3` (`cf-worker-ciciclabel`) |

Two domain classes attach differently:
- **In-zone** (`*.cicilabel.com`) → **Workers Custom Domains** (Workers Domains API).
- **Partner-owned** (`hrhandloom.in`) → **Cloudflare for SaaS Custom Hostnames**
  (they can't be Workers Custom Domains — the hostname isn't in our zone).

## 2. The "do no harm" rule (why the incident happened)

A shared project must **never** be mutated by a per-partner lifecycle operation.
Three paths violated this and each took the shared worker down for all tenants:

| Lifecycle step | Bug | Blast radius |
|---|---|---|
| provision → `setEnvVars` | (already guarded) | — |
| attach domain → `setBaseUrlEnvStep` | `setEnvVars` on the shared worker | CF `setEnvVars` re-uploads a **placeholder** script + wipes all bindings |
| remove → `deleteProject` | deleted the shared worker | **worker gone for every tenant** |

**Guard:** `partnerIsOnSharedProject(partner, container)`
(`apps/backend/src/modules/deployment/providers/resolve-partner-provider.ts`) —
true when `resolveProvisioningMode` says `shared` **and** the partner's
`projectRef` equals the configured shared id/name. All destructive per-partner
paths now early-return on it. Shipped in **PR #1068**.

### Do-no-harm sweep (also #1068)
Four more per-partner paths were unguarded — all on the **shared Vercel** project
(`storefront-shared`, shared by 8 partners) via the legacy Vercel-only
`DeploymentService` (addressed by `vercel_project_id`):
- partner + admin **redeploy** routes (with `update_env` they pin ONE partner's
  publishable key onto the shared project, then redeploy it platform-wide),
- `set-storefront-base-url.ts` + `backfill-storefront-deployments.ts` scripts.

All now gated on `partnerIsOnSharedProject()`.

## 3. Restoring the shared worker (runbook)

**Reusable script: [`scripts/deploy-shared-storefront-worker.sh`](../../../scripts/deploy-shared-storefront-worker.sh)** —
run `CLOUDFLARE_API_TOKEN=cfat_… ./scripts/deploy-shared-storefront-worker.sh`
(a Workers-Scripts:Edit token; the SSM zone token can't deploy workers). It does
everything below and bakes the full Vercel-parity build vars (Stripe key,
multi-tenant, backend URL, S3 host/pathname). The manual steps, for reference:

The worker builds **only in its own checkout**, not nested in the jyt pnpm
workspace (OpenNext resolves Next against the hoisted root `node_modules` → 54
esbuild "Could not resolve" errors). Recipe:

```bash
# 1. copy the submodule OUT of the workspace
rsync -a --exclude node_modules --exclude .next --exclude .open-next --exclude .git \
  apps/storefront-starter/ /tmp/sf-build/
cd /tmp/sf-build

# 2. build env (NEXT_PUBLIC_* are inlined at BUILD time)
export CLOUDFLARE_API_TOKEN=<workers-scripts-edit token>
export CLOUDFLARE_ACCOUNT_ID=c9b8b538ae53cd197539e3d1228e6dbe
export NEXT_PUBLIC_MULTI_TENANT=true
export NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://v3.jaalyantra.com
export NEXT_PUBLIC_STRIPE_KEY=$(aws ssm get-parameter --name /jyt/prod/STRIPE_PUBLISHABLE_KEY --with-decryption --query Parameter.Value --output text)
export NODE_OPTIONS="--max-old-space-size=6144"

# 3. standalone install + build + deploy
pnpm install --ignore-workspace --no-frozen-lockfile
pnpm exec opennextjs-cloudflare build
pnpm exec opennextjs-cloudflare deploy
```

Notes:
- `wrangler.jsonc` `vars` carries only `MEDUSA_BACKEND_URL`; `wrangler deploy`
  overwrites the worker config with that file, so **server-read runtime secrets**
  (e.g. `STOREFRONT_REVALIDATE_SECRET`) must be set with
  `wrangler secret put STOREFRONT_REVALIDATE_SECRET --name nextjs-starter-medusa`.
- Success check: `curl https://nextjs-starter-medusa.saranshis.workers.dev/`
  returns the "No storefront here" fallback (not the placeholder); unknown-tenant
  Host → 403 (correct until a tenant's domain + alias exist).

## 4. Cloudflare for SaaS — partner-owned domains (PR #1069)

`CloudflareWorkersProvider` branches on `shouldUseSaas(host)` (partner-owned host
**and** `saas_fallback_origin` configured): `addDomain`/`removeDomain`/
`verifyDomain`/`describeDomain` use `/zones/{zone}/custom_hostnames` instead of
Workers Custom Domains. `describeDomain` returns the partner's CNAME target (→
fallback origin) + ownership + SSL-validation TXT records for the partner-ui card.

`addDomain` also creates a **scoped `<domain>/*` Worker Route** → the shared
worker (custom hostnames are served via a route, not a Custom Domain), and
`removeDomain` deletes it. Never `*/*` (would hijack in-zone Vercel-served
subdomains). Route creation is best-effort — a failure doesn't fail the attach.

Config: `deployment_account.api_config.saas_fallback_origin` / `zone_name`, or
`CLOUDFLARE_SAAS_FALLBACK_ORIGIN` env. Off entirely when no fallback origin is
set (backward-compatible). **The account token must carry `SSL and
Certificates: Edit` + `Workers Routes: Edit` + `DNS: Edit` (zone) on top of
`Workers Scripts: Edit` (account)** for the full flow — the mid-session `cfat_`
account token has only Workers Scripts + Zone:Read, so it must be re-scoped or
replaced before the partner-ui SaaS path works end-to-end.

### One-time zone setup (done / to-do)
1. **Fallback origin DNS** — `mt.cicilabel.com  AAAA 100::` (proxied, originless). ✅ done
2. **Zone fallback origin** — set to `mt.cicilabel.com` (SSL/TLS → Custom Hostnames). ✅ done (status `active`)
3. **Worker Route** — `hrhandloom.in/*` → `nextjs-starter-medusa`. ✅ done (id `66e3a649…`)
   - Use a **scoped** `<domain>/*` route per partner, NOT `*/*` — a wildcard
     route would hijack the `*.cicilabel.com` subdomains that Vercel serves.
4. Per partner: create the **custom hostname**, partner CNAMEs their domain →
   `mt.cicilabel.com` and adds the ownership/SSL TXT records.

The custom hostname routes to the **originless fallback origin**; the **Worker
Route** is what actually invokes the worker (which reads `Host` and resolves the
tenant). Apex partner domains need CNAME-flattening/ALIAS or DNS on Cloudflare.

## 5. Required Cloudflare API token scopes

| Scope | Level | Needed for | Status |
|---|---|---|---|
| Workers Scripts → **Edit** | Account | deploy/manage the worker | ✅ (cfat_) |
| DNS → **Edit** | Zone (cicilabel.com) | fallback-origin + subdomain records | ✅ (prod token) |
| SSL and Certificates → **Edit** | Zone | custom hostnames + fallback origin | ✅ (prod token) |
| **Workers Routes → Edit** | Zone | route custom hostnames → worker | ✅ (prod token) |
| Zone → **Read** | Zone | metadata / zone-name lookup | ✅ |

The **prod token** (`/jyt/prod/CLOUDFLARE_API_TOKEN`) now carries **DNS:Edit +
SSL and Certificates:Edit + Workers Routes:Edit + Zone:Read** — it is the single
automation token for the whole SaaS flow. (The mid-session `cfat_` = Workers
Scripts + Zone:Read; `cfut_` = read-only — both superseded.)

## 6. Current live state & remaining tails

- ✅ Shared worker rebuilt + live (real multi-tenant app).
- ✅ Vercel `storefront-shared`: empty `NEXT_PUBLIC_STRIPE_KEY` fixed to the live
  SSM key + `STOREFRONT_REVALIDATE_SECRET` added, redeployed.
- ✅ SaaS wired: fallback-origin DNS + zone fallback origin (`active`) + Worker
  Route `hrhandloom.in/*` → worker. Ready to add the custom hostname (dashboard
  or partner-ui once #1069 ships). Prod token has all edit scopes.
- ✅ PR #1068 merged (guards). PR #1069 open (SaaS custom-hostname provider path
  **+ per-partner scoped Worker Route create/delete**).
- ⏳ After #1069 deploys: set `saas_fallback_origin=mt.cicilabel.com` +
  `zone_name=cicilabel.com` on the CF deployment account (the admin validator
  ships with #1069 — prod rejects the fields until then), and re-scope the
  account token (add SSL:Edit + Workers Routes:Edit + DNS:Edit).
- ⏳ `wrangler secret put STOREFRONT_REVALIDATE_SECRET` on the worker.
- ⏳ Set `saas_fallback_origin=mt.cicilabel.com` on the deployment account so the
  partner-ui "Add custom domain" flow drives SaaS once #1069 ships.
- ⏳ Re-enable hr-handloom's storefront after #1068 backend deploys (re-attaches
  its domain in shared mode).
