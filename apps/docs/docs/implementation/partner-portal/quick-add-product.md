---
title: "Quick Add Product (AI-assisted)"
sidebar_label: "Quick Add Product"
sidebar_position: 4
---

# Quick Add Product — Implementation

The Quick Add flow is a narrower alternative to the full product-create form, aimed at single-variant artisan products. It also integrates a Qwen-based vision model that drafts title + description from a photo, gated by a per-partner monthly quota.

This doc covers the three layers that ship together:

1. The **Quick-create endpoint** (composes Medusa workflows)
2. The **AI description pipeline** (external platform → workflow → quota)
3. The **partner UI** (chooser modal, quick form, describe button, upgrade banner)

## 1. Quick-create endpoint

### Route

`POST /partners/stores/:id/products/quick`

Source: `src/api/partners/stores/[id]/products/quick/route.ts`.

Middleware: registered in `src/api/middlewares.ts` **before** the `:productId` matcher so `/quick` isn't eaten as a product id (same hazard as `/variants/batch`).

### Request

```json
{
  "title": "Handmade cotton dari",
  "description": "Optional sentences.",
  "images": ["https://…/1.jpg", "https://…/2.jpg"],
  "thumbnail": "https://…/1.jpg",
  "price": 2500,
  "stock_quantity": 17
}
```

- `title` and `price` are required.
- `stock_quantity` is optional — omitted or `0` means we skip stock seeding.
- Currency and location are resolved server-side from the store, never passed in.

### What it composes

```
createProductsWorkflow        →  product + option + variant + price
  └── batchInventoryItemLevelsWorkflow  →  stock level at default location
```

The route:

1. Calls `validatePartnerStoreAccess` to ensure the partner owns the store.
2. Re-fetches the store via `query.graph` with `supported_currencies.*` because the validator's store object doesn't include currency info.
3. Picks the default currency (`supported_currencies.find(is_default)`) — 400 if none.
4. Runs `createProductsWorkflow` with a hard-coded shape: one `"Default option"` with value `"Default option value"`, one variant, one price.
5. If `stock_quantity > 0`, refetches the product to grab the auto-created `inventory_items.inventory.id`, then calls `batchInventoryItemLevelsWorkflow` with a `create` entry scoped to `store.default_location_id`.

Returns `201 { product }`.

### Why compose instead of build a new workflow

Two reasons:

- **Drift**: `createProductsWorkflow` is where Medusa owns the invariants (price_set setup, variant option wiring, sales channel links). Re-implementing those is a future bug.
- **Testability**: integration test just asserts "product + variant + price + level exist" after one call — the composition is the contract.

### Test

`integration-tests/http/partner-store-products-api.spec.ts` → `POST /partners/stores/:id/products/quick creates product + variant + price + stock in one shot`. Creates, re-reads, asserts all four entities persist. Runs on the shared test env; no mocks.

## 2. AI description pipeline

### Architecture

```
Partner UI (quick form)
       │
       │ POST /partners/ai/describe-image { imageUrl, hint? }
       ▼
Partner route — quota check → describe workflow → record usage
       │
       ▼
describeProductImageWorkflow
       │
       ├─ findAiProviderStep       (resolve SocialPlatform + decrypt api_key)
       │
       └─ callVisionApiStep        (POST /chat/completions with image_url)
       │
       ▼
{ title, description }
```

No AI key lives in env vars. The key is stored encrypted on a `SocialPlatform` row — rotatable from the admin UI, scoped to an audit trail via the existing social-platform subscribers.

### Storing the Qwen provider

Admins set this up once per deployment in **Admin → Settings → External Platforms → Create**:

| Field | Value |
|---|---|
| Name | `Qwen DashScope` (anything containing "qwen" matches the fallback lookup) |
| Category | `other` |
| Auth type | `api_key` |
| Base URL | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| Status | `active` |
| `api_config` | `{ "api_key": "sk-…", "model": "qwen-vl-max" }` |
| `metadata` | `{ "role": "ai_product_description" }` |

On create/update, the `social_platform.created` / `.updated` subscriber at `src/subscribers/social-platform-credentials-encryption.ts` runs `encryptionService.encrypt(api_config.api_key)` and stores `api_config.api_key_encrypted` (plaintext is deleted). The subscriber now understands `api_key` in addition to OAuth tokens it already handled.

### Provider lookup (in workflow)

`findAiProviderStep` prefers the explicit role tag:

1. `listSocialPlatforms({ metadata: { role: "ai_product_description" } }, { take: 1 })`
2. Fallback: scan active platforms for `name.toLowerCase().includes("qwen")`

This means swapping providers is a metadata flip — no code change. The `role` convention is the canonical hook; name-match is backstop for platforms seeded before we started using it.

### The model call

`callVisionApiStep` hits the **OpenAI-compatible** `/chat/completions` endpoint that DashScope exposes. The system prompt:

> You write product copy for a handmade crafts marketplace. Given an image (and optional hint), respond with JSON only… Never invent measurements or materials you can't see.

Key decisions:

- `response_format: { type: "json_object" }` to force JSON, plus a tolerant parser that strips markdown code fences if the model adds them.
- `temperature: 0.2` — we want consistent, boring copy, not creative.
- 45-second abort controller — Qwen vision can be slow on cold starts.
- All failures throw typed `MedusaError` so the endpoint layer can decide whether to surface as 4xx or 5xx.

### Encryption helpers

New helpers in `src/modules/socials/utils/token-helpers.ts`:

- `decryptApiKey(apiConfig, container)` — reads `api_key_encrypted`, falls back to plaintext `api_key` with a warning.
- `encryptApiKey(apiKey, container)` — encrypts for direct writes.

Kept the generic shape (`api_key` / `api_key_encrypted`) so other non-OAuth platforms (OpenAI, Anthropic, …) can reuse it.

## 3. Quota & upgrade flow

### Module

`src/modules/ai_usage/` — minimal append-only event log.

- **Model** `ai_usage_event { id, partner_id, operation, metadata }` — indexed on `(partner_id, operation, created_at)` for fast month-count queries.
- **Service** `AiUsageService` exposes:
  - `countThisMonth(partnerId, op)` — UTC calendar-month boundary.
  - `checkQuota(partnerId, op)` → `{used, limit, allowed}`.
  - `recordUsage(partnerId, op, metadata?)`.
- **Constant** `MONTHLY_QUOTA = { image_describe: 10 }` — single source of truth for limits. Bump here when plan tiers change.

Registered in `medusa-config.ts` alongside the other local modules. Migration `Migration20260422120000.ts` creates the table.

### Endpoint gate

`POST /partners/ai/describe-image` flow:

```ts
const quota = await aiUsage.checkQuota(partner.id, "image_describe")
if (!quota.allowed) {
  res.status(402).json({
    upgrade_required: true,
    code: "ai_quota_exhausted",
    used, limit, message,
  })
  return
}

await aiUsage.recordUsage(partner.id, "image_describe", { imageUrl })

const { result } = await describeProductImageWorkflow(req.scope).run(…)

res.json({ title, description, usage: { used: quota.used + 1, limit } })
```

We record **before** the vision call, not after. This is intentional:

- **Anti-race**: two concurrent requests both see `used: 9`; without pre-recording, both pass the check and both run a paid model call.
- **Fairness tradeoff**: a failed provider call still burns a slot. That's fine for free-tier — it's an anti-abuse buffer, not a metering ledger. When real subscriptions land, we'll add compensating adjustments.

`GET /partners/ai/usage` returns the current-month shape `{ image_describe: { used, limit, allowed } }` so the UI can render a counter without waiting for a failed describe call.

### Test

`integration-tests/http/partner-ai-usage-api.spec.ts` covers:

- Initial `GET /partners/ai/usage` returns `{used:0, limit:10, allowed:true}`.
- After seeding 10 events via the service directly, `POST /describe-image` short-circuits with **402** and the full payload — verifies the gate runs before any vision call, and without a configured provider.
- Per-partner isolation: partner A's usage doesn't affect partner B.

## 4. Partner UI

### Route layout

`/products/create` is now a **chooser** (two-card modal), not the advanced form:

| Path | Component |
|---|---|
| `/products/create` | `product-create-choice` (Quick / Advanced picker) |
| `/products/create/quick` | `product-quick-create` |
| `/products/create/advanced` | `product-create` (existing full form) |

Wired in `apps/partner-ui/src/dashboard-app/routes/get-partner-route.map.tsx`. The existing "Create" button on the product list (`<Link to="create">`) lands on the chooser.

### Quick form

`apps/partner-ui/src/routes/products/product-quick-create/product-quick-create.tsx`:

- React Hook Form + Zod schema (title/description/price/stock).
- Photos uploaded via `usePartnerUpload` hook; URLs held in local state.
- New hook `useCreateQuickProduct` posts to `/partners/stores/:id/products/quick`.
- Currency label pulled from the first store's `supported_currencies`.

### Describe button

Visible only when at least one photo is uploaded. Next to it sits an `X/10 free` counter fed by `useAiUsage()`. The button:

- Disabled when `describeQuota.allowed === false` or while in-flight.
- On click, calls `useDescribeImage()` with the first image URL and the current title as optional hint.
- Pre-fills title only if empty (keeps partner edits), always replaces description.

### 402 handling

The mutation's `onError` inspects the error:

```ts
if (err?.status === 402 && err?.upgrade_required) {
  setUpgradeBanner({ used, limit, message })
} else {
  toast.error(err?.message || "…")
}
```

The banner is a `<Alert variant="warning">` at the top of the form body with a **See plans** button that calls `handleSuccess("/settings/plan")` — routing the partner to their existing subscription page. Dismissible (they can keep working even while capped).

### Why not a nested Dialog/FocusModal for the upgrade prompt?

The quick form is already inside a `RouteFocusModal`. Stacking a second modal on top is finicky with `@medusajs/ui`'s focus management — an inline `Alert` banner does the job with one less render tree to coordinate. If we need a harder-stop experience later (block the whole form), we'll swap to `StackedFocusModal`.

## Files changed

Backend:
- `src/api/partners/stores/[id]/products/quick/route.ts` — new
- `src/api/partners/ai/describe-image/route.ts` — new
- `src/api/partners/ai/usage/route.ts` — new
- `src/api/middlewares.ts` — 3 new middleware entries
- `src/workflows/ai/describe-product-image.ts` — new
- `src/modules/ai_usage/` — new module
- `src/modules/socials/utils/token-helpers.ts` — `decryptApiKey` / `encryptApiKey`
- `src/subscribers/social-platform-credentials-encryption.ts` — handles `api_key`
- `medusa-config.ts` — registers `ai_usage` module
- `src/api/partners/stores/[id]/products/[productId]/route.ts` — added `variants.inventory_items.inventory.*` fields so a freshly-created product's stock page works immediately

Partner UI:
- `apps/partner-ui/src/routes/products/product-create-choice/` — new
- `apps/partner-ui/src/routes/products/product-quick-create/` — new
- `apps/partner-ui/src/hooks/api/ai.ts` — new (`useAiUsage`, `useDescribeImage`)
- `apps/partner-ui/src/hooks/api/products.tsx` — `useCreateQuickProduct`
- `apps/partner-ui/src/dashboard-app/routes/get-partner-route.map.tsx` — re-route `/products/create` tree

Tests:
- `integration-tests/http/partner-store-products-api.spec.ts` — quick-create round-trip
- `integration-tests/http/partner-ai-usage-api.spec.ts` — quota gate, usage endpoint, per-partner isolation

## Future work

- **Per-plan quota multiplier** — wire `useSubscription()` into the backend so paid partners get `MONTHLY_QUOTA[op] * tier_multiplier`. Right now every partner gets 10.
- **Admin usage report** — aggregate view of AI cost per partner for capacity planning.
- **Failure-refund** — if the Qwen call errors out, we currently still burn a slot. Once we have real billing, compensating adjustments should roll that back.
- **Describe-all-images** — right now only the first photo is sent. Could send up to 3 and have the model reason across them (cost concern: tokens grow linearly).
- **Mastra-style prompt fixtures** — system prompt is hard-coded. Worth moving to a prompt registry when we add a second AI operation.
