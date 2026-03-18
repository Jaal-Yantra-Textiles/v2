# Storefront Deployment

Each partner's storefront is deployed as a separate Vercel project from the `nextjs-starter-medusa` repository.

## Architecture

```
Main repo (Jaal-Yantra-Textiles/v2)
  └── apps/storefront-starter (git submodule)
        └── Points to: Jaal-Yantra-Textiles/nextjs-starter-medusa
```

The storefront is a **git submodule**. `.gitmodules` maps `apps/storefront-starter` to:
```
https://github.com/Jaal-Yantra-Textiles/nextjs-starter-medusa.git
```

## Provisioning Flow

When a partner enables their storefront (`POST /partners/storefront/provision`):

1. **Create Vercel project** — `storefront-{handle}` linked to the git repo
2. **Set environment variables** — Medusa URL, publishable key, Stripe key, S3 config
3. **Add custom domain** — `{handle}.cicilabel.com`
4. **Create DNS records** — Cloudflare CNAME + Vercel verification
5. **Trigger deployment** — Initial production deployment
6. **Save metadata** — Project ID, domain stored in partner record

### Install Command

`vercel.json` in the storefront sets:
```json
{ "installCommand": "pnpm install --no-frozen-lockfile" }
```

This prevents `frozen-lockfile` failures in the monorepo workspace.

## Vercel Preview Domain Handling

Vercel generates preview URLs like:
```
storefront-sharlho-g4lo5qlcq-user-projects.vercel.app
```

The `find-website-by-domain` workflow handles these with fallbacks:
1. Direct domain match
2. Parse Vercel URL pattern → extract handle → match against stored domains
3. Subdomain match (first segment)

## Middleware

`src/middleware.ts` handles:
- Country code detection and redirect (e.g. `/` → `/in/`)
- Cache ID cookie management
- **Editor mode bypass** — `?visual_editor=true` or `?theme_editor=true` skip cookie redirect to prevent iframe loops

## Default Shipping Options

When a store is created (`create-store-with-defaults` workflow):
- Fulfillment sets (Shipping + Pickup) are auto-created
- Service zones with country geo-zones
- **Default shipping options** are auto-created:
  - Standard Shipping (linked to Delhivery for India, manual for others)
  - Return Shipping
- Fulfillment providers auto-linked based on country (Delhivery for IN)

## Render Deployment (Partner UI)

The partner UI is deployed on Render as a static site:
- `render.yaml` defines the service
- `public/_redirects` file ensures SPA routing works: `/*    /index.html   200`
- Build command: `pnpm run vercel-build`

## Troubleshooting

### "ERR_PNPM_OUTDATED_LOCKFILE" on Vercel
The `vercel.json` `installCommand: "pnpm install --no-frozen-lockfile"` should fix this.

### "Couldn't find any pages or app directory"
The `.gitmodules` file must exist in the main repo. Without it, the submodule directory is empty on clone.

### Redirect loops in editor iframe
The middleware detects `?visual_editor=true` / `?theme_editor=true` and uses `NextResponse.next()` instead of redirect for cookie setting.

### Stale theme in iframe
The layout detects `Sec-Fetch-Dest: iframe` header and uses `cache: "no-store"` for `getWebsite()`.
