# Storefront Deployment

Each partner's storefront is a separate Vercel project, provisioned on demand from the shared [`nextjs-starter-medusa`](https://github.com/Jaal-Yantra-Textiles/nextjs-starter-medusa) repo.

## Architecture

```
partner.vercel_project_id ─► Vercel project "storefront-{handle}"
                               └─ linked to: Jaal-Yantra-Textiles/nextjs-starter-medusa
                                  └─ branch: main (or partner.storefront_branch)

partner.storefront_domain ─► Cloudflare CNAME ─► cname.vercel-dns.com
                                                 └─ Vercel routes to above project

partner.website_id ───────► website row (domain column)
                                └─ website_domain rows (aliases incl. primary)
                                     └─ find-website-by-domain resolves any
```

Vercel is **linked directly to the storefront repo**. It is no longer deployed as a subdirectory of the monorepo — that older model relied on a git submodule at `apps/storefront-starter` and caused submodule-clone failures on the first build.

The `apps/storefront-starter` submodule still exists for local development convenience; it plays no role in production deploys.

## Partner columns

| Column | Purpose |
|---|---|
| `storefront_domain` | Canonical domain (e.g. `acme.cicilabel.com`) |
| `website_id` | FK to the `website` row serving content |
| `vercel_project_id` | Vercel project ID |
| `vercel_project_name` | Human-readable project name |
| `vercel_last_deployment_id` | Latest triggered deployment |
| `vercel_linked` | **Boolean. `true` iff the provision workflow finished end-to-end.** Single source of truth for "has a working storefront." |
| `storefront_repo` | Git repo to deploy from. Falls back to `VERCEL_STOREFRONT_REPO`. Per-partner override enables BYO repos. |
| `storefront_root_dir` | Optional subdirectory. Null = repo root. |
| `storefront_branch` | Deployed branch (default `main`). |

Legacy `partner.metadata` fields (`vercel_project_id`, `storefront_domain`, `storefront_provisioned_at`) are read for back-compat only; new code writes to the table columns.

## Provisioning flow

`provisionStorefrontWorkflow` — `POST /admin/partners/:id/storefront/provision` or `POST /partners/storefront/provision`:

1. **Create website row** — `website` + primary `website_domain` alias. Runs *before* any Vercel call so domain lookups can never race a missing row.
2. **Seed default pages** — T&C, Privacy, Contact.
3. **Create Vercel project** `storefront-{handle}` linked to `storefront_repo`.
4. **Set env vars** — `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`, `NEXT_PUBLIC_MEDUSA_BACKEND_URL`, `NEXT_PUBLIC_STRIPE_KEY`, S3 image host config.
5. **Add custom domain** `{handle}.{ROOT_DOMAIN}` to the project.
6. **DNS** — Cloudflare CNAME + Vercel verification records.
7. **Trigger deployment.**
8. **Save partner columns** — project id/name, repo/branch, last deployment id, **`vercel_linked=true`**. Only reached after every prior step succeeds.

If any step fails, compensation soft-deletes the website row and the partner flag stays `false`, so `find-website-by-domain` won't resolve a half-provisioned record.

## Domain resolution

`find-website-by-domain` (used by `/web/website/:domain/*`):

1. Direct match on `website.domain` (unique index).
2. `website_domain` alias table — supports custom domains, marketing aliases, future transfers.
3. `partner.storefront_domain` → `partner.website_id` → website. Covers the rare case where a partner row has a storefront domain but the website row's own canonical domain differs.

The earlier Vercel preview URL and single-label subdomain fallbacks were removed — they solved for phantom cases and masked the real bug (website rows that were never created).

## Multi-domain / alias support

Each website has exactly one primary domain plus any number of aliases, stored in the `website_domain` table:

```
website_domain
  id
  domain        (unique, nullable soft delete)
  is_primary    (exactly one per website)
  website_id    (FK, cascade delete)
```

- `POST /admin/websites/:id/domains` — add alias (rejects a domain owned by another website).
- `DELETE /admin/websites/:id/domains/:domainId` — remove alias (refuses `is_primary`).
- `POST /partners/storefront/domain` — partner self-service: adds a custom domain to Vercel **and** inserts an alias row.
- Renaming `website.domain` via `updateWebsiteWorkflow` syncs the primary alias row.

## Environment (Railway)

| Variable | Purpose |
|---|---|
| `VERCEL_TOKEN` | Team-scoped API token |
| `VERCEL_TEAM_ID` | Target team |
| `VERCEL_STOREFRONT_REPO` | Default repo (`Jaal-Yantra-Textiles/nextjs-starter-medusa`) |
| `VERCEL_STOREFRONT_BRANCH` | Default branch (`main`) |
| `ROOT_DOMAIN` | Apex for default subdomains (`cicilabel.com`) |
| `MEDUSA_BACKEND_URL` | Passed into each storefront as `NEXT_PUBLIC_MEDUSA_BACKEND_URL` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` | CNAME + verification record management |
| `S3_FILE_URL`, `S3_PREFIX` | Derived into `MEDUSA_CLOUD_S3_*` for Next.js image optimization |

`VERCEL_STOREFRONT_ROOT_DIR` is no longer required — leave unset so Vercel uses the storefront repo root.

`VERCEL_STOREFRONT_IGNORE_COMMAND` is no longer used — the "ignore build on backend-only commits" hack was only needed when Vercel was linked to the parent monorepo.

## Scripts

### `backfill-storefront-deployments.ts`

Recover existing partners to the current schema/account. Processes partners with `vercel_linked=true`, or an explicit id list.

```bash
# Dry run against specific partners
railway ssh -- bash -c '\
  DRY_RUN=1 BACKFILL_PARTNER_IDS=pt_abc,pt_def \
  bash -c "node_modules/.bin/medusa exec ./src/scripts/backfill-storefront-deployments.js"'

# Live run (DB writes + Vercel relink, no deploy trigger)
railway ssh -- bash -c '\
  BACKFILL_PARTNER_IDS=pt_abc,pt_def \
  bash -c "node_modules/.bin/medusa exec ./src/scripts/backfill-storefront-deployments.js"'

# With deployment trigger
railway ssh -- bash -c '\
  TRIGGER_DEPLOY=1 BACKFILL_PARTNER_IDS=pt_abc,pt_def \
  bash -c "node_modules/.bin/medusa exec ./src/scripts/backfill-storefront-deployments.js"'
```

Per partner it: backfills metadata → columns, populates `storefront_repo/root_dir/branch`, ensures a website row and primary alias, relinks the Vercel project to the current repo, clears legacy `rootDirectory` and `commandForIgnoringBuildStep`, sets `vercel_linked=true`, optionally triggers a fresh deployment.

### `reprovision-partner-storefront.ts`

Create a fresh Vercel project for a single partner — used when the prior project was deleted, transferred, or moved to a different Vercel team.

```bash
railway ssh -- bash -c '\
  PARTNER_ID=pt_abc \
  bash -c "node_modules/.bin/medusa exec ./src/scripts/reprovision-partner-storefront.js"'
```

Mirrors the admin provision route logic without the HTTP layer. Requires the partner to have a store, default sales channel, and matching publishable API key.

## Historical: monorepo → storefront-repo migration

The initial deployment model linked Vercel to the monorepo with a submodule and an `ignoreBuildCommand` hack to skip builds when the backend changed. That was abandoned because:

- Vercel doesn't auto-clone submodules on first deploy → cold starts broke.
- `ignoreBuildCommand` only runs after a successful clone; couldn't fix the clone failure.
- The submodule was for dev ergonomics only; production didn't need the coupling.

The current model links Vercel directly at `nextjs-starter-medusa`. Local dev still uses the submodule at `apps/storefront-starter` for iteration. The in-prod partners were migrated via `backfill-storefront-deployments.ts` with an explicit partner id list to avoid touching half-provisioned records.

## Troubleshooting

**"Failed to link {repo}. You need to add a Login Connection..."**
The Vercel team hasn't authorized the GitHub App for this org. Dashboard → team settings → Integrations → GitHub → Connect → authorize the GitHub org. The app only needs to be *installed* on the GitHub org once; each Vercel team authorizes against the existing installation.

**Provision says "already provisioned, use redeploy"**
The partner has a `vercel_project_id`. The route verifies the project is live on Vercel: if it is, refuse; if not (stale id), clear and re-run. Re-running should proceed through.

**Storefront hits 404 on `/web/website/:domain`**
Check: (a) the partner's `vercel_linked` flag is `true`; (b) a `website` row exists for that domain; (c) a `website_domain` alias row matches. If (a) is true but (b)/(c) are false, the provision workflow failed mid-flight — inspect the workflow execution log and re-run via the admin provision route.

**Vercel deployment complains it can't find the storefront code**
Confirm `VERCEL_STOREFRONT_ROOT_DIR` is unset on Railway (or the partner column is null). Legacy projects set to `apps/storefront-starter` will try to build from that subpath in the storefront repo, which doesn't exist there.
