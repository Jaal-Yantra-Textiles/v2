# Marketing Web — Architecture & Redesign Plan

Single source of truth for the `apps/jyt-web` Next.js site: what's there today, where it's going, and the decisions already locked in. This doc exists so we don't rediscover the codebase every time we touch the marketing site.

Repo path: `~/Developer/jyt-web/jyt-web` (sibling repo to `~/Developer/jyt`, not in the monorepo).

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind v4 (`@import "tailwindcss"` in `styles/globals.css`) — no shadcn/Radix |
| Headless UI | `@headlessui/react` + `@heroicons/react` |
| Animation | `framer-motion`, `motion` |
| Rich content | Tiptap (25+ extensions) + `reactjs-tiptap-editor` |
| Data | `@tanstack/react-query` + `SiteDataProvider` |
| Maps | `react-map-gl` + `mapbox-gl` + `maplibre-gl` |
| Observability | `@sentry/nextjs` |
| Fonts (today) | Switzer (Fontshare CDN) + Instrument Serif (Google) |

## Current routes

All routes share the single root `app/layout.tsx` (providers: `ApiQueryClientProvider` → `SiteDataProvider` → `VisualEditorProvider`; chrome: `<Footer>` + `<BlueprintGrid>`; nav lives inside each page, not in the root layout).

| Route | Purpose |
|---|---|
| `/` | Homepage — hero, testimonials, feature carousel, product tour, problem statement, logo cloud |
| `/about` | Company story (uses `AnimatedNumber`, gradients) |
| `/pricing` | Pricing tables |
| `/contact` | Contact form |
| `/blog`, `/blog/[slug]` | Editorial — Tiptap-rendered, TOC sidebar |
| `/partner` | Partner intake |
| `/login` | Auth |
| `/map` | Interactive map (Mapbox/MapLibre) |
| `/guides/[token]` | Dynamic guide pages |
| `/tours/visit/[token]` | Virtual tour viewer |
| `/agreement/[id]`, `/content/[slug]` | Dynamic content surfaces |
| `/privacy-policy`, `/terms-of-service` | Legal |

## Component inventory

Top-level `components/` grouped by role:

- **Nav / layout** — `navbar.tsx`, `footer.tsx`, `container.tsx`, `manual-drawer.tsx`, `manual-table-of-contents.tsx`
- **Hero / sections** — `hero-section.tsx`, `section.tsx`, `section-loading.tsx`, `release-banner.tsx`
- **Editorial** — `blog-post-content.tsx`, `post-main-content-area.tsx`, `post-metadata-sidebar.tsx`, `PostTableOfContents.tsx`, `tiptap-renderer.tsx`, `problem-statement.tsx`
- **Visual / data** — `testimonials.tsx`, `bento-card.tsx`, `feature-carousel.tsx`, `product-tour.tsx`, `stats-panel.tsx`, `logo-timeline.tsx`, `logo-cloud.tsx`, `logo-cluster.tsx`, `linked-avatars.tsx`
- **UI primitives** — `button.tsx`, `heading.tsx`, `text.tsx`, `subheading.tsx`, `eyebrow.tsx`, `link.tsx`, `gradient.tsx`
- **Forms** — `ContactForm.tsx`, `SubscribeForm.tsx`
- **Decoration** — `blueprint-grid.tsx`, `plus-grid.tsx`, `spinner.tsx`, `animated-number.tsx`, `gradient.tsx`
- **Specialty** — `keyboard.tsx` (98KB visual prop), `map.tsx`, `screenshot.tsx`
- **Slides** — `slides/{PaymentProcessSlide,SignUpAvailabilitySlide,TasksListSlide}.tsx`
- **CMS** — `visual-editor/BlockWrapper.tsx`

## Today's design tokens (`styles/globals.css`)

Two custom oklch scales already in place:

- **Olive 50–950** — warm graphite, primary text & dark surfaces
- **Clay 50–950** — terracotta accent, links, eyebrows, accent CTAs

Utilities: `.bg-dot-grid`, `.bg-hero-wash`, `.font-display`, `.font-serif`, `.font-mono`, `.text-balance`, plus a `.prose-olive` typography preset for blog content.

Light-only. No dark mode.

---

## Design system

The shipping design system lives at `~/Downloads/JYT/design-system/`. It is the source of truth for tokens, components, and page composition patterns. The earlier `main_UI-elements.html` mockup remains a useful audience-fork prototype but is **not** authoritative — the formalized system supersedes it.

### Files

| File | Purpose |
|---|---|
| `tokens.css` | All design tokens — color (oklch), typography scale, spacing ladder, radii, motion. Single source. |
| `components.css` | All reusable building blocks, prefixed `kt-*` (e.g. `kt-topbar`, `kt-btn`, `kt-card`, `kt-stat`, `kt-quote`, `kt-list`, `kt-pill`, `kt-eyebrow`, `kt-display`, `kt-section`, `kt-footer`). ~40 components. |
| `index.html` | Style-guide / specimen index. Shows the foundation surface (color, type, spacing, buttons, forms, cards, lists, quote, section shells, byline, callout, footer). |
| `components-library.html` | UI-component reference. ~60 components beyond the foundations: dialog, sheet, drawer, popover, table, data-table, tabs, breadcrumb, pagination, select, combobox, toast, skeleton, spinner, progress, steps, etc. |
| `About.html` | Reference page composition — hero, manifesto (dark), three-hubs grid, timeline, team grid, values, contact card. |
| `Blog.html` | Reference page composition — hero, featured article, filter bar, article grid, index list, long-form article page (prose w/ drop-cap, pullquotes), end-card waitlist, related. |

### Key vocabulary

- **Tokens** are CSS custom properties on `:root`: `--bg`, `--bg-deep`, `--cream`, `--ink`, `--ink-soft`, `--ink-mute`, `--ink-dark-bg`, `--rule`, `--rule-soft`, `--rule-dark`, `--accent`, `--accent-deep`, `--accent-soft`, `--accent-pale`, plus `--font-sans` (Inter Tight), `--font-serif` (Instrument Serif), `--font-mono` (JetBrains Mono), full type scale (`--t-display-xl` → `--t-mono-s`), spacing ladder (`--s-1` → `--s-11`), radii (`--r-sm` → `--r-pill`), motion (`--ease`, `--ease-out`, `--dur-fast/base/slow`).
- **Components** use the `kt-*` prefix. Variants are modifier classes (`kt-card.dark`, `kt-btn.ghost`, `kt-stat.dark`, `kt-card.accent`).
- **Display headlines** use `kt-display` with size modifiers (`xl/l/m/s`). Italic-serif accent words are styled via inline `<em>` inside the heading — already wired in components.css.
- **Eyebrows** use `kt-eyebrow` with optional pulsing dot (`.dot.pulse`); mono-uppercased, accent-deep color.

### Gaps relative to the redesign brief

The formalized design system **does not include** an audience mode-toggle component or the three-way fork overlay from `main_UI-elements.html`. The reference pages (About, Blog) use a standard `kt-topbar` + `kt-nav` with static links (System, Components, Blog, About).

This means: if we keep the three-way fork from the earlier mockup, we add a new component to the system, namespaced `kt-mode-toggle` (the sliding pill) plus a `kt-fork` overlay variant. Both follow the existing token/typography conventions so they'll feel native.

### Adoption path

`jyt-web` does not yet use this design system. Adoption plan:

1. Copy `tokens.css` + `components.css` into `apps/jyt-web/jyt-web/styles/` (as `kt-tokens.css` + `kt-components.css`), imported from `globals.css`. Source-of-truth lives in this repo so updates are tracked.
2. Add Inter Tight + Instrument Serif + JetBrains Mono via `next/font/google` in `app/layout.tsx`, mapping the CSS variables `--font-sans` / `--font-serif` / `--font-mono` to the loaded fonts (overriding the design system's `font-family` declarations to point at the next/font CSS variables).
3. Build the homepage by composing `kt-*` primitives in JSX. New domain components (hero, mode toggle, fork overlay, audience-conditional copy slots) get their own files but use `kt-*` building blocks underneath.
4. Existing components (`navbar.tsx`, `footer.tsx`, `hero-section.tsx`, etc.) get rewritten or restyled to consume the new tokens and `kt-*` classes — see [component reuse matrix](#component-reuse-matrix).

## Redesign brief

Source mockup: `~/Downloads/JYT/main_UI-elements.html` (~1500 lines, self-contained). Treat as audience-fork *prototype only* — the design system above is authoritative for visuals.

The mockup is a **three-way audience fork** — one site, three audiences, mode-switched in place:

| Mode | Label | Audience | Sections |
|---|---|---|---|
| `consumer` | "Wearing" | End buyers, garment-curious | hero, problem (strikethrough quote), artisan grid, waitlist |
| `investor` | "Backing" | VCs, angels | hero, metrics strip (4-cell), thesis lede, two-sided hypothesis split (Gucci vs Rukmini), Medo stack flow, raise card (€500K) |
| `platform` | "Building" | Fashion brands evaluating the OS | hero, three-surfaces grid, features bento, testimonials, demo CTA |

A sticky topbar with a sliding-pill toggle switches modes. First-visit fork overlay offers the three cards. Referrer inference: linkedin/angellist → investor, instagram/tiktok → consumer, github/producthunt → platform. Persisted via `localStorage` + `?mode=` URL param.

### Decisions locked in

#### 1. Brand by domain

Same codebase serves two domains. Brand identity, footer attribution, and the "platform" mode's product naming swap by `Host` header / Next.js middleware:

| Domain | Primary brand | Platform brand inside `Building` mode |
|---|---|---|
| `kindhealth.com` | Kind Health | JaalYantra |
| `jaalyantra.com` | Jaal Yantra | JaalYantra |

Note: the mockup file is named after an earlier working title ("Kind Thread"). The shipping brand is **Kind Health**. All wordmarks, emails, and form slugs use `kindhealth` / `Kind Health`. The mockup file (`main_UI-elements.html`) is referenced as a visual prototype only — its copy is not authoritative.

Implementation surface:
- `middleware.ts` reads `request.headers.get("host")`, sets a `x-brand` header.
- A `BrandProvider` (server component) resolves `host → BrandConfig` and provides logo / wordmark / footer copy / email addresses via React context.
- Brand strings (taglines, raise amount, geography copy) live in a single `lib/brand.ts` map keyed by host.

#### 2. Mode model — hybrid (option c)

- Single `/` route (no `/wearing`, `/backing`, `/building` routes).
- First visit with no `localStorage` key and no referrer match → fork overlay (full screen, dismissible via "Skip" button).
- Subsequent visits → mode loaded from `localStorage`, fork skipped.
- Topbar pill toggles between modes client-side; same `?mode=…` written to URL via `history.replaceState` so a copied link reproduces the visitor's view.
- Mode-tagged sections (`data-aud="consumer|investor|platform"`) cross-dissolve via CSS — no React re-render needed for the switch.

#### 3. Data via Next.js route handlers, backed by backend Forms module

The mockup expects:

| Endpoint | Shape | Source of truth |
|---|---|---|
| `GET /api/metrics` | `{ artisans, signups_per_mo, accepted_per_mo, orders_per_mo, aov_eur, gmv_mtd_eur, hubs, last_updated }` | TBD — derive from backend (Persons + Orders + Subscribers) once metric service exists |
| `GET /api/artisans` | `[{ id, name, craft, location, story, image }]` | Persons module, filtered by tag (`artisan`) — needs implementing |
| `GET /api/pieces` | reserved (product passport) | Out of scope this round |
| `POST /api/waitlist` | `{ email, mode: "consumer" }` | Forms module — define a `kindhealth_waitlist` form |
| `POST /api/intro` | `{ email, fund }` | Forms module — define a `kindhealth_investor_intro` form |
| `POST /api/demo` | `{ email, mode: "platform" }` | Forms module — define a `jaalyantra_demo_request` form |

Form-module integration follows the same pattern as the existing pre-launch forms (see [Forms — pre-launch hardening](../forms/)). Submissions land as `FormResponse` rows tied to the form definition, with idempotency + rate limit + auth middleware already in place.

Until the metric/artisan endpoints exist, the mockup's `fetchJSON` already falls back to inline mock data — that fallback stays as a feature-flag, not a hack.

#### 4. Theme migration — restyle in place

**Keep**: layout structure, route topology, component file paths, `SiteDataProvider`, Tiptap pipeline, `BlueprintGrid` backdrop, Headless UI primitives.

**Migrate**: tokens, fonts, the visual treatment of each existing component to match the mockup language (italic-`em` accent words inside large Instrument Serif headlines, mono-eyebrows, generous whitespace, light-and-dark-panel inversions).

Restyling existing components is preferred over rewriting — preserves data adapters, avoids a parallel component tree.

---

## Token migration map

The current olive/clay scales are already 80% aligned with the mockup. The migration tunes values and adds a third color role (cream) plus an explicit `--rule` border token.

| Token | Today | Mockup target |
|---|---|---|
| `--bg` | `olive-50` | `oklch(0.95 0.018 80)` warm cream |
| `--bg-deep` | (none) | `oklch(0.92 0.024 78)` |
| `--cream` | (none, uses `white`) | `oklch(0.97 0.012 80)` |
| `--ink` | `olive-900` | `oklch(0.22 0.015 55)` |
| `--ink-soft` | `olive-700` | `oklch(0.42 0.018 60)` |
| `--ink-dark-bg` | (none) | `oklch(0.20 0.020 55)` dark inverse panels |
| `--rule` | (ad-hoc `border-olive-200`) | `oklch(0.82 0.018 70)` |
| `--rule-soft` | (none) | `oklch(0.88 0.014 70)` |
| `--accent` | `clay-500` | `oklch(0.68 0.13 45)` terracotta |
| `--accent-deep` | `clay-700` | `oklch(0.55 0.14 40)` |
| `--accent-soft` | `clay-200` | `oklch(0.85 0.06 50)` |

Plan: keep the `olive-*` / `clay-*` Tailwind scales (don't break blog typography), add the new tokens above as CSS variables, and update the components in [the reuse matrix](#component-reuse-matrix) to consume tokens instead of raw scale colors where the mockup demands a token-level abstraction (e.g., `--rule` for borders, `--cream` for inverse-panel surfaces).

## Font migration

| Role | Today | Target | Notes |
|---|---|---|---|
| Sans | Switzer (Fontshare CDN) | **Inter Tight** (Google Fonts via `next/font`) | Geometric, similar weight ladder — swap is low-risk |
| Display | Instrument Serif (Google) | Instrument Serif (unchanged) | Already matches |
| Mono | (only `.font-mono` fallback) | **JetBrains Mono** (Google Fonts via `next/font`) | Heavy use in mockup — eyebrows, tags, metric labels, buttons. Load `400` + `500` weights. |

Switching from CDN to `next/font` lets us self-host (faster + no FOUT) and is the right time to consolidate to Google Fonts for all three.

## Component reuse matrix

For each existing component: keep, restyle, replace, or new.

| Existing component | Mockup counterpart | Action | Notes |
|---|---|---|---|
| `navbar.tsx` | Topbar w/ brand-mark + nav + mode pill | **Restyle + extend** | Add `<ModeToggle>` pill child component, brand-mark dot, mono-cased nav labels |
| `footer.tsx` | Mode-aware footer grid | **Restyle + extend** | 4-column grid with mode-conditional column (Wearing/Backing/Building) |
| `hero-section.tsx` | Hero w/ side panel + audience copy | **Restyle (significant)** | Add `hero-grid` 1.4fr/1fr layout, audience-conditional `<span class="for-consumer/investor/platform">` slots, side-panel rows |
| `problem-statement.tsx` | Problem quote w/ strikethroughs | **Restyle** | Strip current 54KB layout; replace with `.problem-quote` (Instrument Serif, line-through-clay) — preserve component name + props |
| `product-tour.tsx` | Medo flow (Design → Produce → Supply → Sell) | **Replace** | Current product-tour is interactive walkthrough; mockup wants a static 4-cell flow-grid. Different intent — new component `<FlowGrid>` |
| `bento-card.tsx` | Bento (6-cell, mixed spans) | **Restyle** | Card stays; restyle to mockup's dark/light/accent tone variants + grid span class |
| `testimonials.tsx` | 3-card testimonial grid | **Restyle** | Drop carousel; switch to static 3-up grid w/ italic-serif quote + author block |
| `stats-panel.tsx` | Metrics strip (4-cell, dark) | **Restyle (significant)** | Replace 17KB layout with `.metrics` dark band + `.metrics-grid` |
| `logo-cloud.tsx` / `logo-timeline.tsx` / `logo-cluster.tsx` | (no direct counterpart) | **Keep, restyle borders/spacing** | Useful filler; tune to new tokens |
| `feature-carousel.tsx` | (no direct counterpart) | **Defer** | Decide whether to keep on consumer mode or retire |
| `ContactForm.tsx` | Demo CTA form | **Restyle + reuse** | Same form shape (email + intent), new visual treatment |
| `SubscribeForm.tsx` | Waitlist form | **Restyle + reuse** | Same |
| `release-banner.tsx` | "We assumed you're an investor" banner | **Replace** | Different semantics — new `<ModeInferBanner>` |
| `eyebrow.tsx` | Mono eyebrows | **Restyle** | Switch font to JetBrains Mono, uppercase, letter-spaced |
| `button.tsx` | Pill buttons | **Restyle** | Pill radius, mono caps, ink-fill + ghost variants |
| **New components needed** | | | |
| — | Fork overlay | **New** | `<ForkOverlay>` — full-screen, three cards, dismiss button |
| — | Mode toggle pill | **New** | `<ModeToggle>` — sliding pill with three buttons |
| — | Hypothesis split (Gucci vs Rukmini) | **New** | `<HypothesisSplit>` — light pane + dark pane side-by-side |
| — | Raise card | **New** | `<RaiseCard>` — large €amount + side form |
| — | Surfaces grid | **New** | `<SurfacesGrid>` — 3-column platform-mode flow |
| — | Mode provider | **New** | `<ModeProvider>` — context, `localStorage`, referrer inference |
| — | Brand provider | **New** | `<BrandProvider>` — host-keyed brand config |

## Composition recipes

Patterns for composing `kt-*` primitives. These are not new components — they're documented arrangements of existing components, plus a few small variant additions to `components.css`.

Aesthetic inputs blended in this layer:
- **Kind Health design system** — italic-serif accents, mono eyebrows, dark/light inversion, editorial typography (load-bearing visual weight via type).
- **[Area / plugin-value-scrum.figma.site](https://plugin-value-scrum.figma.site)** — photography-led restraint, numbered benefit grids, generous whitespace (load-bearing visual weight via imagery).

Both share the warm-cream + terracotta palette, so tokens stay unchanged. The blend is at the composition layer.

### New `components.css` additions

| Class | Purpose |
|---|---|
| `kt-card-img.photo` | Variant of `kt-card-img` that accepts a real `background-image` URL (or `<img>` slot) instead of the diagonal-stripe placeholder. Used in maker cards, blog cards, hero photo. |
| `kt-hero.minimal` | Hero variant that drops the italic-`<em>` accent + side panel and replaces with a thin headline + lede + landscape photo. Used as an alternate homepage hero composition for image-led brand moods. |

### Patterns (no new components required)

- **Numbered benefits grid (4-col)** — From Area. Composes `kt-card` × 4 with `kt-eyebrow` numbered `01`/`02`/`03`/`04` + `kt-card-title` + `kt-card-body`. No `kt-card-img`. Reads as a restraint section between two photo-led moments.
- **Restraint hero (text-only)** — `kt-display.l` (no `<em>`) + thin `kt-section-head .lede` + single ghost CTA. No side panel, no eyebrow dot. The opposite of the italic-em hero — pick per page mood.
- **Photo hero** — `kt-display.xl` + lede + full-bleed landscape photo below. `kt-eyebrow` with pulsing dot above the headline if there's a live signal to surface (e.g., metric ticker).

### Deferred to Phase 2

| Class | Purpose |
|---|---|
| `kt-compare` | Comparison table (Area-style: vs WebSurge vs HyperView). Bordered grid, mono column headers, checkmark/dash cells. For Building/platform mode — "JaalYantra vs Shopify vs custom build". |

## Audience-mode section mapping (homepage)

The order of sections on `/` depends on mode. Sections without `data-aud` show in all modes (header, footer, hero shell).

```
[ topbar (all) ]
[ release banner / mode-infer banner (all, conditional) ]
[ hero — copy switches per mode ]
[ section: problem  ] ← consumer
[ section: thesis   ] ← investor
[ section: surfaces ] ← platform
[ section: artisans ] ← consumer
[ section: medo flow ] ← investor
[ section: features bento ] ← platform
[ section: hypothesis split ] ← investor
[ section: testimonials ] ← platform
[ section: metrics strip ] ← investor
[ section: waitlist  ] ← consumer
[ section: raise     ] ← investor
[ section: demo      ] ← platform
[ footer (all, mode-aware columns) ]
```

## Brand-by-domain wiring

```
Request → next.js middleware.ts
       → reads request.headers.get("host")
       → resolves host → BrandKey ("kindhealth" | "jaalyantra")
       → sets request.headers "x-brand" = BrandKey
                ↓
   app/layout.tsx (server component)
       → reads x-brand from headers()
       → loads BrandConfig from lib/brand.ts
       → <BrandProvider value={config}>{children}</BrandProvider>
                ↓
   any component → useBrand() → { wordmark, logoUrl, tagline,
                                  raiseAmount, addresses,
                                  platformBrandName, ... }
```

`lib/brand.ts` shape (proposal):

```typescript
export type BrandKey = "kindhealth" | "jaalyantra";

export type BrandConfig = {
  key: BrandKey;
  wordmark: string;           // "Kind Health" | "Jaal Yantra"
  shortName: string;          // "Kind" | "JYT"
  tagline: string;
  platformBrandName: string;  // "JaalYantra" — same for both
  raise: { amount: string; round: string; year: number };
  emails: { primary: string; founder: string };
  geographies: string[];      // ["Florence", "Bagru", "Sydney"]
  // ...
};

const BRANDS: Record<BrandKey, BrandConfig> = { /* ... */ };

export function brandFromHost(host: string | null): BrandConfig {
  if (!host) return BRANDS.jaalyantra;
  if (host.includes("kindhealth")) return BRANDS.kindhealth;
  return BRANDS.jaalyantra;
}
```

Local dev: read `?brand=` query param as override so we can preview both brands on `localhost:3000` without `/etc/hosts` editing.

## Data wiring (Forms module)

For the three POST endpoints, define matching form definitions in the backend Forms module (see [Forms](../forms/) for the schema pattern). Each form:

- Has its own slug (`kindhealth_waitlist`, `kindhealth_investor_intro`, `jaalyantra_demo_request`)
- Carries `mode` and brand origin in the response payload
- Routes notifications via existing form-submission subscriber

Next.js route handlers (`apps/jyt-web/app/api/{waitlist,intro,demo}/route.ts`) proxy POST → backend `/web/forms/:slug/submit`, mapping the mockup's `{ email, mode }` body to the form-module response shape.

For the read endpoints (`/api/metrics`, `/api/artisans`):

- **Phase 1** (this iteration): the mockup's mock fallback handles it. Endpoints return 404 → client uses `MOCK_METRICS` / `MOCK_ARTISANS`.
- **Phase 2**: add a `marketing-metrics` workflow + endpoint that aggregates from Orders, Persons (tagged `artisan`), and Subscribers, cached at the CDN edge.

## Implementation phases (proposed)

Phase 1 — foundation (this iteration, scope TBC):

1. Tokens + fonts migration in `styles/globals.css` + `next/font` setup
2. `BrandProvider` + `ModeProvider` contexts + `middleware.ts`
3. `<ForkOverlay>` + `<ModeToggle>` + `<ModeInferBanner>` new components
4. Navbar/footer restyle, mode-pill integration
5. Homepage rewrite to mockup section order with audience filtering

Phase 2 — data:

6. Forms-module form definitions for waitlist/intro/demo
7. Next.js route handlers wiring forms to backend
8. Metrics + artisans endpoints (live data)

Phase 3 — pages adjacent to homepage:

9. `/about`, `/pricing`, `/contact`, `/partner` retoned to new visual system

Each phase shippable independently behind separate PRs.

---

## Decisions

- **Brand naming — resolved 2026-05-11**: shipping brand is **Kind Health** on `kindhealth.com`; **Jaal Yantra** on `jaalyantra.com`. Earlier "Kind Thread" copy in the mockup is a working title only.

## Open questions

These need answers before Phase 1 ships:

1. **Fork overlay blocking behavior** — block-the-page (mockup's literal behavior) hurts first-paint conversion. Confirm: should the overlay auto-dismiss after N seconds, be dismissible to the consumer view, or stay fully blocking until clicked?
2. **Scope of redesign** — homepage only, or also `/about`, `/pricing`, `/contact`, `/partner`, `/blog`? Phase 3 above assumes adjacent pages eventually follow; confirm whether they're in scope now.
3. **Mode persistence on non-homepage routes** — when user is in "investor" mode and visits `/blog`, does the navbar still show the mode pill? Are blog posts mode-aware? Recommend: mode pill persists in navbar everywhere, but only homepage sections are mode-filtered.
4. **Brand strings — are mockup values production?** €500K Seed, "Florence · Bagru · Sydney", founder/contact email format — placeholders or real?
5. **Existing homepage components — fate of `feature-carousel.tsx`** — no direct counterpart in mockup. Retire, or keep on consumer mode?
6. **Mode pill placement on mobile** — mockup hides nav at `<960px`; where does the mode pill go? Inside a hamburger menu, or always-visible?
7. **Phase 2 metric aggregation source** — confirm Orders module is where GMV lives, and that an `artisan` tag on Persons is the right filter for the artisan grid.

## References

- Mockup: `~/Downloads/JYT/main_UI-elements.html` (Kind Thread three-fork prototype)
- Existing forms work: [Forms](../forms/)
- Existing storefront theme system (per-partner): [Storefront theme](../storefront/theme-system.md) — different problem (per-partner storefronts), but a precedent for token-driven theming
- Repo: `~/Developer/jyt-web/jyt-web` (sibling repo, not in monorepo)
