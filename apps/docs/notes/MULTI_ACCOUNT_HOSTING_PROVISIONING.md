# Multi-account storefront hosting provisioning (Vercel / Cloudflare Pages / Render / Netlify)

Status: **S1–S3 + S5(Netlify/Render) + admin CRUD + partner-agnostic routes done**
(2026-07-12, branch `feat/storefront-hosting-rotation-s3`). S1/S2 previously merged.

## What shipped 2026-07-12 (this branch)

- **S3 rotation wiring** — `provisionStorefrontWorkflow` is now provider-agnostic:
  it selects a `deployment_account` via `decideProvisionTarget` (least-loaded of
  the preferred provider → spill to any provider → legacy env fallback), runs
  create/env/domain/DNS/deploy through the resolved `HostingProvider`, stamps the
  new partner columns, and increments `project_count` (with compensating
  rollback). **Default provider for new partners = Cloudflare Pages** (override
  via `DEFAULT_HOSTING_PROVIDER` or `partner.hosting_provider`).
- **New partner columns** (`Migration20260712150000`): `hosting_provider`,
  `deployment_account_id`, `deployment_project_id`, `deployment_project_name`.
  Applied locally. vercel_* columns kept in sync for Vercel partners.
- **S5 adapters**: `netlify-provider.ts` + `render-provider.ts` implement
  `HostingProvider` (repo-linked create, env, custom domain, deploy, dnsTarget →
  `*.netlify.app` / `*.onrender.com`). Registered in `registry.ts`.
  `HostingCredentials.extra` carries provider-specific ids (Netlify
  `github_installation_id`/`account_id`, Render `owner_id`, …) decrypted from
  api_config.
- **Cloudflare Workers: NOT built (decision).** Repo→Worker linking is
  dashboard-only in CF's API (open gap, workers-sdk#12058); only build-trigger/
  env/deploy/custom-domain are API-driven. **Cloudflare Pages** (already built,
  `POST /accounts/{id}/pages/projects`) is the Cloudflare hosting path.
- **S4 admin CRUD**: `/admin/deployment-accounts` (+ `/:id`) — create (token
  AES-encrypted at rest via encryption module → `api_config.token_encrypted`,
  redacted with `token_present`), list (capacity surfaced), update (cutoff via
  `status:"full"`, round-up via `cutoff_max`), delete. Validators + middleware
  wired. **Admin React UI DONE**: `src/admin/routes/settings/deployment-accounts/
  page.tsx` (Settings → "Storefront Hosting") — list Table + create FocusModal +
  edit Drawer + row actions (cutoff toggle / delete), provider-specific config
  fields, token `_present` badge, capacity/at-cap display. Hooks in
  `src/admin/hooks/api/deployment-accounts.ts`.
- **Provider-agnostic partner routes**: `GET/DELETE /partners/storefront` and the
  provision dup-check now dispatch through `resolveHostingProviderForPartner`
  (status/teardown work for CF/Netlify/Render partners, not just Vercel). DELETE
  decrements the account's `project_count`.
- **partner-ui**: `settings/stores` surfaces the hosting provider; provision/
  status/custom-domain + DNS-records/verify flow already existed.
- Tests: `account-selector` (12) + `hosting-providers` (43 total) green.

**Next**: admin React UI for deployment-accounts; backfill existing Vercel
partners to a Vercel env-account row; configure a Cloudflare Pages + Netlify
`deployment_account` with real `cutoff_max`; live provision smoke-test.

---

Status (historical): **in progress** — slice 1 built (2026-07-04).

## Goal

Add Cloudflare Pages (later Render, Netlify) as storefront **hosting** targets
alongside Vercel, and **rotate across multiple accounts per provider** so we can
run on free tiers and "cut off" a full account so new partners flow to the next.
Keep the existing provision workflow shape unchanged.

## Current architecture (as-is)

- One workflow `provisionStorefrontWorkflow` (`src/workflows/stores/provision-storefront.ts`),
  8 steps: create website row → seed pages → **Vercel** project (GH repo) → env vars →
  add domain (+verification) → **Cloudflare DNS** CNAME → Vercel TXT verification →
  trigger deploy → save partner columns.
- `DeploymentService` (`src/modules/deployment/service.ts`) holds all Vercel (hosting)
  + Cloudflare (DNS-only) API calls. Single-account creds from env:
  `VERCEL_TOKEN`/`VERCEL_TEAM_ID`, `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID`.
- Partner columns: `storefront_domain`, `website_id`, `vercel_project_id`,
  `vercel_project_name`, `vercel_last_deployment_id`, `vercel_linked`, `storefront_repo`,
  `storefront_root_dir`, `storefront_branch`. Website row = content only (no provider field).
- Cloudflare is **DNS only** today; `deploy/cloudflare/` has mothballed Containers skeleton.
- **No provider choice, no rotation** — every partner → same Vercel team + CF zone.

## Decisions (2026-07-04)

- **Provider model**: providers-by-role with encrypted creds, à la `SocialPlatform`,
  but a dedicated `deployment_account` (kept out of socials). Providers: vercel,
  cloudflare, render, netlify. Each account has a free-tier `cutoff_max`.
- **Selection**: least-loaded active account under its cap; **manual cutoff** = flip
  `status` to `full`; **round up** = raise `cutoff_max` when the account goes paid.
- **Credentials**: DB table, tokens encrypted via the encryption module (add/cutoff at
  runtime, no redeploy).
- **Provider choice per partner**: new partners default to Cloudflare Pages; existing
  stay on Vercel (round-robin across all accounts within the chosen provider).

## Slices

- **S1 (DONE)** — `deployment_account` model (provider/role/label/api_config/cutoff_max/
  project_count/priority/status) + migration + pure `account-selector.ts`
  (least-loaded-under-cap, provider filter) + 7 unit tests.
- **S2** — `HostingProvider` interface (createProject, setEnvVars, addDomain+verification,
  triggerDeploy, getProject). Extract `VercelHostingProvider` from today's service; add
  `CloudflarePagesProvider` (CF Pages API: project ← GH repo, env vars, custom domain,
  deployment). DNS steps stay (CNAME → `<project>.pages.dev` for Pages).
- **S3** — workflow dispatch: select account (S1) → resolve its decrypted creds → run
  steps 3-7 via the provider (S2) → on success increment `project_count` + stamp
  `partner.hosting_provider` + `partner.deployment_account_id`. Add those two columns.
- **S4** — admin/DP account management: add account (encrypt token), set cutoff_max,
  cutoff toggle, per-account partner counts; backfill existing partners → current env
  account; capacity-exhausted alert.
- **S5** — Render + Netlify providers (same interface).

## Free-tier cutoff references (fill when configuring)

- Vercel Hobby: ~limited projects/deploys per account → set conservative `cutoff_max`.
- Cloudflare Pages free: generous project count, 500 builds/mo.
- Render / Netlify free: per-account app/site caps.
Set each account's `cutoff_max` to the safe ceiling; raise on upgrade.
