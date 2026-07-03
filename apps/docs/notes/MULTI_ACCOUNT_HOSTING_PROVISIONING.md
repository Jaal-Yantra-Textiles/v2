# Multi-account storefront hosting provisioning (Vercel / Cloudflare Pages / Render / Netlify)

Status: **in progress** — slice 1 built (2026-07-04). Branch `feat/839-unsubscribe-bounce-webhooks`.

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
