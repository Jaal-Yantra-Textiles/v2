# Storefront — Overall Code Map (how it works)

> High-level architecture of `apps/storefront` (Cici Label commerce storefront)
> and how it talks to `apps/backend`. Companion to the chat-specific
> `STOREFRONT_CHAT_MAP.md`. Findings as of 2026-06-29.

---

## Package: `apps/storefront` (Next.js 15 App Router → Medusa 2.x)

### Tech stack

- **Next.js 15.3.9** App Router, **React 19**, TypeScript 5.
- **Tailwind 3** + Medusa UI preset + Radix; fonts Inter + Playfair Display.
- **`@medusajs/js-sdk`** backend client; **Stripe** + **PayU** payments;
  **Lenis** smooth scroll; **framer-motion**; **@react-three/fiber/three**;
  **@tiptap** rich text; **@ai-sdk/react** chat.
- Path aliases (`tsconfig.json`): `@lib/*`, `@modules/*`, `@pages/*`.
- `next.config.js`: apex-domain redirects (www/shop → apex), image optim
  (AVIF/WebP, 30-day TTL), S3 remote patterns.

### Routing & layout hierarchy

```
src/app/
├── layout.tsx                       # ROOT: fonts, JSON-LD, analytics, <SmoothScroll> (Lenis)
└── [countryCode]/                   # region/country dynamic segment (set by middleware)
    ├── (main)/                      # route group → renders Nav + Footer + banners
    │   ├── layout.tsx               # Nav (NavScrollHeader), CartMismatchBanner, FreeShippingNudge, Footer
    │   ├── page.tsx                 # HOME: Hero (cookie-gated) → ScrollStage, HolidaySection, featured, partners
    │   ├── store/                   # product browse + filter/sort + StoreAiSearch (inline)
    │   ├── products/[handle]/       # PDP (+ design/ subpages); variants, raw materials, design score
    │   ├── collections/[handle]/
    │   ├── categories/[...category]/# catch-all category tree
    │   ├── cart/                    # cart page (in (main) for nav/footer)
    │   ├── account/                 # PARALLEL routes @dashboard / @login (auth-gated)
    │   │   └── @dashboard/{profile,addresses,designs,orders}
    │   ├── order/[id]/{confirmed,transfer}/
    │   ├── design/ · gallery/ · partners/ · pages/[slug]/ (CMS)
    └── (checkout)/                  # route group → minimal header, NO nav-scroll, NO footer
        └── checkout/{cart/[cartId], payment-failed}/
```

- **Route groups:** `(main)` = full chrome; `(checkout)` = stripped chrome.
- **Parallel routes:** `/account` renders `@dashboard` or `@login` by auth state.
- **Async params:** App Router — always `await props.params`.

### Module organisation (`src/modules/*`)

| Module | Owns |
|--------|------|
| `home` | Hero, ScrollStage, featured products, holiday promos, partner showcase, **ai-search-chat** |
| `store` | Product listing, refinement/filter, sort, `StoreAiSearch` inline search |
| `products` | PDP, variant selection, raw-material info, design-score display |
| `cart` | Cart summary, line items, quantity controls |
| `checkout` | Payment method, address forms, shipping method, order review |
| `account` | Dashboard layout, profile, orders, addresses, saved designs |
| `order` | Order confirmation + history + status |
| `categories` / `collections` | Category/collection nav + pages |
| `layout` | Nav (locale/country selector), Footer, banners |
| `common` | Reusable: `localized-client-link`, `smooth-scroll`, `modal` (Context), `cart-totals`, `line-item-*`, inputs, icons |
| `shipping` | Shipping method select, free-shipping nudge |
| `website` | CMS pages |
| `gallery` | Album/portfolio view |
| `skeletons` | Loading placeholders |

Convention: `components/` = building blocks, `templates/` = page-level layouts.

### Data layer (how it talks to the backend)

- **SDK singleton** `src/lib/config.ts`: `new Medusa({ baseUrl, publishableKey })`,
  intercepts fetches to inject `x-medusa-locale`. Node runtime (not Edge).
- **Server actions / fetchers** in `src/lib/data/*.ts` (all `"use server"`):
  `cart.ts`, `products.ts`, `customer.ts`, `orders.ts`, `regions.ts`,
  `designs.ts`, `collections.ts`, `categories.ts`, `variants.ts`, `ai-*.ts`.
- **Caching:** Next cache with **tags** `{type}-{cacheId}` where `cacheId` =
  `_medusa_cache_id` cookie; `cache: "force-cache"` + `next: getCacheOptions(...)`.
  Mutations call `revalidateTag(...)` to purge (e.g. `carts-{cacheId}`).
- **Field selection:** queries name fields to shrink payloads (e.g. products pull
  `*variants.calculated_price`, `+designs.*`, raw materials, etc.).
- **Never expose the SDK to the client** — always route through server actions.

### State & cross-cutting concerns

- **No client global store** (no Redux/Zustand) — state lives in **cookies** +
  server fetches:
  - `_medusa_jwt` (httpOnly, 7-day) — auth; `_medusa_cart_id` — session cart;
    `_medusa_country_code` — region; `_medusa_cache_id` — revalidation tag.
- **Region/country** (`src/middleware.ts`): hourly-cached region fetch → detect
  country from URL segment / `x-vercel-ip-country` / `NEXT_PUBLIC_DEFAULT_REGION`
  → build `Map<iso2, StoreRegion>` → 307-redirect to `/{countryCode}/…` if missing.
- **Cart** is server-side (Medusa); every page re-fetches by cookie; mutations
  revalidate the cart tag.
- **Smooth scroll:** Lenis `<ReactLenis root {lerp:0.1, duration:1.5}>` at root.
- **Analytics:** JYT analytics script in root layout (`automatic.jaalyantra.com`).
- **i18n:** region-driven via `[countryCode]` + `x-medusa-locale` header +
  `LocalizedClientLink`.
- **Hero cookie-gating:** first visit shows full ScrollStage hero + sets
  `HeroSeenMarker` cookie; returning visitors skip the hero media fetch (avoids
  hydration flicker). *(Relevant to the chat move — the hero is the current chat
  mount point.)*

### Local API routes (`src/app/api/*`)

| Route | Purpose |
|-------|---------|
| `/api/ai-chat` (POST) | **SSE streaming proxy** → backend `POST /store/ai/chat`; injects publishable key; `duplex:"half"`, dynamic. |
| `/api/cart/promotions` (POST) | apply promo codes → `applyPromotions()` |
| `/api/payu/success` (POST) | PayU callback → `POST /store/payu/complete` → order confirm |
| `/api/payu/failure` (POST) | failure redirect → `/checkout/payment-failed` |

Route Handlers (not server actions) are used where **streaming** or **webhook
callbacks** are needed.

### Conventions

- Server Components by default; `"use client"` only for interactive bits
  (modals, forms, Lenis, context consumers).
- Mutations = server actions in `lib/data/*`; errors normalised by
  `util/medusa-error.ts`.
- Dynamic segments: `[countryCode]`, `[handle]`, `[id]`, `[...category]`.

---

## Package: `apps/backend` (Medusa 2.x) — storefront-facing surface

The storefront consumes the **Store API**. Endpoints the storefront depends on:

- `POST /store/ai/chat` — streaming chat (see `STOREFRONT_CHAT_MAP.md`);
  siblings under `src/api/store/ai/`: `search`, `tryon`, `imagegen`, `accessfee`.
- `POST /store/payu/complete` + PayU/Stripe payment rails (see the Store MCP /
  PayU / Stripe notes).
- Standard Store resources via the JS SDK: products, carts, regions, customers,
  orders, collections, categories — plus JYT extensions (designs, partners,
  production story, raw materials, design score).

Business logic lives in the backend; the storefront is **presentation +
orchestration**. UI-only changes (like relocating the chat) don't touch the
backend contract.

---

## New-engineer quick start

1. Read **root layout → `middleware.ts` → `(main)/page.tsx`**.
2. New page → folder under `[countryCode]/(main)/` (or `(checkout)/`).
3. New data/mutation → server action in `src/lib/data/{feature}.ts`.
4. Fetch only in server components/actions; never from the client.
5. After a mutation → `revalidateTag(...)`.
6. Region logic → `middleware.ts` + `getRegion()` in `lib/data/regions.ts`.

> For the AI chat specifically (files, scroll root-cause, the
> move-to-`/chat` + FAB plan), see **`STOREFRONT_CHAT_MAP.md`**.
