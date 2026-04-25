# @jyt/analytics

Client-side analytics tracking script for JYT websites. Single source file, minified with Terser, deployed to CDN.

## Layout

```
src/analytics.js        Source (~6 KB, readable)
scripts/build.js        Terser minification, reads version from package.json
dist/analytics.min.js   Build output (~2 KB; gitignored)
```

## Build

```bash
pnpm --filter @jyt/analytics build
```

Output: `apps/analytics/dist/analytics.min.js` with preamble `JYT Analytics v<package.json version>`.

## Deployment

CI workflow `.github/workflows/deploy-analytics.yml` runs on changes under `apps/analytics/**`, builds, uploads to Cloudflare R2, and purges the CDN cache.

- CDN: `https://automatic.jaalyantra.com/analytics.min.js`
- Tracking endpoint: `https://v3.jaalyantra.com/web/analytics/track` (served by the backend; default if `data-api-url` is omitted)

## Client embed

```html
<script
  src="https://automatic.jaalyantra.com/analytics.min.js"
  data-website-id="YOUR_WEBSITE_ID"
  defer
></script>
```

Optional: `data-api-url` to override the default tracking endpoint.

## Public API

`window.jytAnalytics`:
- `track(event, properties)` — custom event
- `trackPageview()` — manual pageview
- `startHeartbeat()` / `stopHeartbeat()` — visibility-aware liveness ping (30s default)

Automatic on load: pageview, SPA navigation, session (30-min timeout), localStorage visitor ID.

## Releasing a new version

1. Edit `src/analytics.js`.
2. Bump `version` in `package.json` (the preamble reads it; this is the version baked into the CDN comment).
3. Merge to `main`. The deploy workflow rebuilds and pushes to R2.
