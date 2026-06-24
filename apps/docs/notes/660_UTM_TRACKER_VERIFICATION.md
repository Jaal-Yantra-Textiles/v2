# #660 — utm_source=(none): tracker verification (NOT a stale-build bug)

**Date:** 2026-06-24
**Outcome:** No code fix required. The deployed analytics tracker correctly
captures UTM. The `(none)` values are legitimate untagged organic/direct
traffic. Recommend close-as-not-a-bug after the one tagged-URL test below.

## TL;DR
The hypothesis in #660 (and the daemon brief) was that the **deployed**
`analytics.min.js` is a stale build that never sends UTM. **This is false.**

- `apps/analytics/dist/` is **gitignored** (`apps/analytics/.gitignore` → `dist/`).
  Nothing in `dist/` is committed. The local `dist/analytics.min.js` (mtime
  Jun 20) is just a throwaway local artifact — it is NOT what prod serves.
- The deployed bundle is built **fresh by CI** from `src/analytics.js` on every
  push to `main` touching `apps/analytics/**`
  (`.github/workflows/deploy-analytics.yml` → Terser build → Cloudflare R2 →
  cache purge). CDN: `https://automatic.jaalyantra.com/analytics.min.js`.

## Evidence (2026-06-24)
1. **origin/main source already captures UTM.** `src/analytics.js:82 getUTMParams()`
   reads `new URLSearchParams(window.location.search)` over all 5 keys
   (`utm_source/medium/campaign/term/content`), stores first-touch in
   `sessionStorage['jyt_utm']`, and merges into the pageview payload
   (`trackPageview()` ~L191-195). Last commit touching it: #572 (Jun 21 09:59).
2. **The LIVE CDN bundle contains UTM capture.**
   `curl -s https://automatic.jaalyantra.com/analytics.min.js` → 5× `utm_source`,
   19× `utm_`, `URLSearchParams`, `jyt_utm`. Preamble `v1.0.0`.
3. **Live bundle == fresh source build, byte-for-byte.**
   `node apps/analytics/scripts/build.js` then
   `diff <live> <dist/analytics.min.js>` → IDENTICAL. Deployed == current source.
4. **Backend ingestion works live.** `POST https://v3.jaalyantra.com/web/analytics/track`
   with `utm_source/medium/campaign` → HTTP 200. Routes
   `src/api/web/analytics/track/route.ts` + `ingest-batch/route.ts` accept utm_*
   (zod optional); `src/workflows/analytics/track-analytics-event.ts` persists
   `input.utm_source || null` as first-touch on the session.
5. **DB (from #660):** 33/33 sessions have `utm_source=NULL`, split 18
   `referrer_source=google` (organic) + 15 `direct` — all legitimately UTM-less.

Conclusion: client → endpoint → store is fully functional. `(none)` = no
UTM-tagged traffic has landed yet, not a capture/build defect.

## Why "commit the rebuilt dist" would be WRONG
`dist/` is intentionally gitignored and rebuilt by CI. Committing it would
(a) contradict the deploy design and (b) create exactly the stale-committed-dist
risk the issue feared (a hand-committed copy drifting from source). Do not
un-gitignore `dist/`.

## Definitive test to close the issue
Visit any partner storefront that loads the snippet with a tagged URL:
```
https://<partner-storefront>/?utm_source=test&utm_medium=cpc&utm_campaign=qa
```
Then on the analytics DB:
```sql
SELECT utm_source, utm_medium, utm_campaign, referrer_source, created_at
FROM analytics_session ORDER BY created_at DESC LIMIT 3;
```
- New row shows `utm_source=test` → tracker works; close as not-a-bug.
- Stays NULL → snippet not installed on that storefront, or `data-api-url`
  points away from the session-creating route → fix snippet/wiring (suspect #3),
  NOT the bundle.

## Campaign-link QA checklist (prevent future `(none)` confusion)
- Always tag outbound campaign links with `utm_source` + `utm_medium`
  (+ `utm_campaign` for attribution back-fill).
- First landing pageview must fire with the `?utm…` query intact — don't strip
  query before the tracker loads (server redirect that drops query = lost UTM).
- SPA navigations after landing reuse first-touch `jyt_utm` from sessionStorage;
  the landing pageview is the one that must carry UTM.

## Deploy-path reference
- Source: `apps/analytics/src/analytics.js`
- Build: `node apps/analytics/scripts/build.js` (or `pnpm --filter @jyt/analytics build`)
- Output (gitignored): `apps/analytics/dist/analytics.min.js`
- CI: `.github/workflows/deploy-analytics.yml` (push to main on `apps/analytics/**`)
- CDN: `https://automatic.jaalyantra.com/analytics.min.js` (R2, 1y cache, purged on deploy)
- Endpoint default: `https://v3.jaalyantra.com/web/analytics/track`
- To force a redeploy without a source change: re-run the workflow via
  `workflow_dispatch` (it has `workflow_dispatch:` enabled).
