# #349 — Partner storefront Google search indexing — state of play + PR plan

**Issue:** [#349] Google search indexing for partner storefronts (`enhancement, roadmap, storefront`).
**Date:** 2026-06-22 (daemon backend/API wave, chunk 3).
**TL;DR:** The issue's stated "remaining scope" is **stale**. Sitemap, robots, canonicals/hreflang,
**and all four JSON-LD types are already shipped and rendering live.** The only genuinely-remaining
work is (1) **Search Console verification** — which needs a product decision on the verification
*method* before any code — and (2) a **Lighthouse SEO pass** (needs a live browser). Neither is a
clean headless backend/API slice, so this chunk documents reality + a PR-by-PR plan and posts the
verification decision on the issue.

---

## What is ALREADY done (do NOT rebuild)

All paths below are in the `apps/storefront-starter` submodule (Next.js App Router) unless noted.

| Capability | Status | Where |
|---|---|---|
| `robots.txt` (allow + disallow checkout/cart/account/order, sitemap link) | ✅ live | `src/app/robots.ts` |
| `sitemap.xml` (per-country `alternates.languages` + `x-default`, product/collection/category, timeout-guarded, 100/page cap) | ✅ live | `src/app/sitemap.ts` |
| Canonical + hreflang alternates (localhost canonicals eradicated fleet-wide; base URL pinned per serving host) | ✅ live | `src/lib/util/seo.ts` (`buildLocalizedAlternates`), `getBaseURL()` in `src/lib/util/env.ts`; provisioning side `set-storefront-base-url.ts` (#376), auto-pin on domain attach (#374) |
| Clean `<meta name="description">` (HTML-strip + entity-decode + 160-char truncate) | ✅ live | `src/lib/util/seo.ts` `cleanMetaDescription` |
| OpenGraph + Twitter card per product | ✅ live | `products/[handle]/page.tsx` `generateMetadata` |
| **Product JSON-LD** (`schema.org/Product`, `Offer`/`AggregateOffer` low/high, availability from inventory flags, sku, material, image[], url) | ✅ live | `src/modules/products/templates/product-jsonld.ts` → rendered in `src/modules/products/templates/index.tsx:65-79` |
| **Breadcrumb JSON-LD** (`BreadcrumbList`) | ✅ live | `src/lib/util/breadcrumb-jsonld.ts` → rendered `templates/index.tsx:70,79` |
| **Organization + WebSite JSON-LD** (site-wide) | ✅ live | `src/app/layout.tsx:71-95` (two `application/ld+json` scripts in `<head>`) |

**Conclusion:** the "JSON-LD structured data" line item in the #349 comment thread is satisfied. The
prior comments (2026-06-11) closed the canonical/sitemap/robots story fleet-wide across all 6
provisioned storefronts.

---

## What is genuinely REMAINING

### 1. Search Console verification — **needs a product decision first**

There is currently **no** verification hook anywhere. Each partner storefront is a *separate domain*
(custom_domain → website_domain → storefront_domain) and would be a *separate Search Console
property*. There are three mutually-exclusive ways to verify, and they imply very different code:

| Method | What it needs | Code surface | Per-partner token? |
|---|---|---|---|
| **A. HTML meta tag** `<meta name="google-site-verification" content="…">` | a per-website token rendered into `<head>` **always** (orthogonal to analytics provider) | backend: new column + expose in public API; storefront: render in `layout.tsx`; partner-ui: a field to paste the token | yes, one per domain |
| **B. DNS TXT record** | partner (or our provisioning flow) adds a TXT record at the domain's DNS | **zero app code** — pure ops/provisioning; possibly a Vercel domain-API call | n/a (lives in DNS) |
| **C. Google Site Verification API / Search Console API** | a Google service account + OAuth + automated `sites.insert`/verification token mint per domain | substantial backend integration + secret management | automated |

**Note:** `analytics_custom_head` (Website model) already lets a "custom" analytics partner paste
arbitrary `<head>` HTML — they *could* drop a verification meta there today. But it only injects when
`analytics_provider === "custom"`, so it does **not** work for the default `in_house` analytics
partners. So Method A specifically requires a **new always-injected field**, not reuse of
`analytics_custom_head`.

**Recommendation:** **Method A (meta tag)** for self-serve partners — lowest friction, no DNS access
needed, works regardless of analytics choice. DNS-TXT (B) stays available for partners who prefer it
(no code). Defer the API approach (C) until fleet scale demands automation.

→ **Decision posted on #349.** Build PR-1/PR-2 below only once Method A is confirmed.

### 2. Lighthouse SEO pass — needs a live browser (out of headless backend wave)

A Lighthouse SEO audit against a live partner storefront (e.g. `www.sharlho.com`) to catalog any
residual gaps (image alt text, tap-target sizing, crawlable links, structured-data validity via
Google's Rich Results Test). Playwright/Lighthouse-gated → interactive/UI session, not this wave.

---

## PR-by-PR plan (conditional on Method A being chosen)

> Backend PRs land in `apps/backend`; storefront PRs push to the `apps/storefront-starter` submodule
> `main` (user prefers direct push over submodule PRs — see memory `reference_storefront_starter_submodule`).
> The two backend PRs are clean, independent backend/API slices the **next daemon chunk can build**.

- **PR-1 (backend, buildable now if Method A confirmed):** add `seo_head` (or
  `google_site_verification` text, nullable) to the Website model
  (`apps/backend/src/modules/website/models/website.ts`) + a hand-written
  `add column if not exists` migration (see memory
  `reference_medusa_migration_create_if_not_exists_hazard` — never edit an existing
  `create table if not exists`). Mirror the `analytics_custom_head` precedent exactly.
- **PR-2 (backend, stacks on PR-1):** expose it from the public website API
  (`apps/backend/src/api/web/website/[domain]/route.ts`) — add a `seo: { google_site_verification }`
  (or `seo_head`) block to `publicWebsiteData`, mirroring the existing `analytics` block
  (lines 29-33). Per-file integration spec asserting the field round-trips. Also expose a
  partner-side write path mirroring `src/api/partners/storefront/website/analytics/route.ts`.
- **PR-3 (storefront submodule):** render the token in `src/app/layout.tsx` `<head>` — read it from
  the same `getWebsite()` call already in the layout, emit
  `<meta name="google-site-verification" content={…}/>` **unconditionally** (not gated on analytics
  provider). Verify with View-Source on a preview deploy.
- **PR-4 (partner-ui, Playwright-gated):** a "SEO / Search Console" field in the storefront settings
  so partners paste their token (mirror the analytics settings section). UI render slice → interactive
  session.
- **PR-5 (ops, no app code):** run the Lighthouse SEO audit on a live store, file follow-ups, and
  document the DNS-TXT alternative for partners who prefer Method B.

## Watch-outs

- Storefront `layout.tsx` already wraps `getWebsite()` in try/catch (backend unreachable → proceed).
  PR-3 must keep the meta tag optional so a missing token never breaks render.
- The public API curates fields explicitly (`publicWebsiteData`) — a new column is **not** auto-exposed;
  PR-2 must add it to the returned object or the storefront sees nothing.
- Two stores (Shramdaan + a Saransh test partner) carry `vercel_project_id`s for deleted Vercel
  projects (404) — harmless, skipped by scoping; worth a cleanup but not part of #349.
- `getBaseURL()` resolution order (already fixed): `NEXT_PUBLIC_BASE_URL` → `VERCEL_PROJECT_PRODUCTION_URL`
  → `VERCEL_URL` → localhost. Per-store `NEXT_PUBLIC_BASE_URL` is pinned by `set-storefront-base-url.ts`.
</content>
</invoke>
