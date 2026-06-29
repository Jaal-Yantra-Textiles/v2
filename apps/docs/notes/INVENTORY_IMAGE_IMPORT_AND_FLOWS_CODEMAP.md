# Codemap — Inventory image-import, route nesting & inventory-order visual flows

> Exploration record (2026-06-29) backing three roadmap tasks:
> 1. (#769) Fix the failing `inventory/import-from-image` Mastra extraction (use the role-based AI providers).
> 2. (#770) Move the "Import From Image" button off the Inventory Orders page + nest the API under Inventory (Option A — locked).
> 3. (#771) Enable a visual flow that sends inventory-order events/messages so users can mark orders end-to-end; verify the partner APIs.
> 4. (#772) Wire Shiprocket so partner inventory-order completion generates a real shipment + AWB + label (replace free-text tracking). See companion `SHIPROCKET_PROVIDER_CODEMAP.md`.
>
> All paths are under `apps/backend/` unless noted.

---

## Task 1 — `inventory/import-from-image` extraction & why it fails

### The user-facing surface
- Admin UI page: `src/admin/routes/inventory/import-from-image/page.tsx`
  - sub-page `src/admin/routes/inventory/import-from-image/recent-extractions/page.tsx`
  - component `src/admin/components/ai/import-inventory-from-image.tsx`, hooks `src/admin/hooks/api/ai.ts`
- Inventory-orders admin page (the "inventory orders 1" the user referenced): `src/admin/routes/orders/inventory/page.tsx`

### Backend route
- `src/api/admin/ai/image-extraction/route.ts` — `POST /admin/ai/image-extraction` (lines 127-199)
  - request: `{ image_url, entity_type?: "raw_material"|"inventory_item", notes?, threadId?, resourceId?, hints?, verify?, persist?, defaults? }` (lines 8-18)
  - `persist=true` → `extractAndCreateInventoryWorkflow` (`src/workflows/ai/extract-and-create-inventory.ts`) → creates raw_materials + inventory; returns 201
  - `persist=false` → `imageExtractionMedusaWorkflow`; returns 200
- recent: `src/api/admin/ai/image-extraction/recent/route.ts`

### Mastra workflow
- `src/mastra/workflows/imageExtraction/index.ts` — workflow id `"image-extraction"`
  - step `extractItems` (43-180) → `createImageExtractionAgent()` (110), HTTP-URL→base64 (83-101), `agent.generate()`, parse w/ fallback (139-175)
  - step `validateExtraction` (183-199)
- agent factory: `src/mastra/agents/index.ts:114-126`
  - model via `getVisionModelId()` from `src/mastra/providers/openrouter.ts:319-349`
  - **OpenRouter client is hardcoded**: `createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })` (`agents/index.ts:10-12`)
  - free-vision fallback list `FALLBACK_VISION_MODELS` (`openrouter.ts:307-313`): gemini-2.0-flash-exp:free, llama-3.2-90b/11b-vision:free, qwen2.5-vl-72b:free

### ROOT CAUSE — does NOT use the role-based (social-platform) AI providers
Every *working* AI feature resolves its provider through the DB-backed role registry; image-extraction does not.

- Role resolver: `src/mastra/services/ai-platforms.ts`
  - `getAiPlatformForRole(container, role)` (142-239): queries `social_platform` where `category="ai"` + `metadata.role="<role>"` + `status="active"`, decrypts the API key (195), returns provider/model; falls back to `dynamicFreeTextModel` (386)
  - `makeRoleAiGenerate(container, role, …)` (403-451)
  - `AI_ROLES` union (53, 644-651): `ai_search_chat`, `ai_search_embed`, `ai_product_description`, `ai_image_gen`, `ai_digest_summary`, `ai_newsletter_drafter`
  - **There is NO `ai_image_extraction` role**, and no vision-equivalent of `makeRoleAiGenerate` either.
- Working example: `src/workflows/marketing/generate-newsletter-draft.ts:248` → `makeRoleAiGenerate(container, NEWSLETTER_DRAFT_ROLE…)` (role `"ai_newsletter_drafter"`, line 35).

Because image-extraction is pinned to `OPENROUTER_API_KEY` + ephemeral free models, it fails when:
1. `OPENROUTER_API_KEY` is unset in the env (no DB fallback, no graceful error)
2. OpenRouter `/models` is unreachable/rate-limited and the hardcoded free models have expired
3. the vision model returns empty/non-JSON → `items: []` silent no-op (parse fallback `index.ts:139-175`)

> Mirrors the prior `newsletter/generate` qwen3.7-plus "empty text" 503 class of bug — the fix there was switching the prod model. Here the deeper fix is to route through the role registry so operators can pick a vision provider in the admin UI.

### Fix direction
Add an `ai_image_extraction` (vision) role to `AI_ROLES`, add a vision-capable `resolveRoleVisionModel` / `makeRoleAiGenerate`-style helper, and have `createImageExtractionAgent()` resolve via `getAiPlatformForRole(container, "ai_image_extraction")` with `dynamicFreeTextModel`/OpenRouter vision fallback — matching newsletter-drafter et al. This also unblocks admin-configured providers (Cloudflare/DashScope/Vercel AI Gateway/custom OpenAI-compatible).

---

## Task 2 — Move the route under the Inventory nested hierarchy

### Current inventory route tree (`src/api/admin/`)
```
inventory-items/route.ts                                 GET/POST
inventory-items/[id]/labels/route.ts                     GET (barcode PDF)
inventory-items/[id]/split/route.ts                      POST
inventory-items/[id]/rawmaterials/route.ts               POST
inventory-items/[id]/rawmaterials/[rawMaterialId]/route.ts  GET/PUT/DELETE
inventory-items/bulk-import/route.ts                     POST
inventory-items/raw-materials/route.ts                   GET (items enriched w/ raw materials)

inventory-orders/route.ts                                GET/POST
inventory-orders/[id]/route.ts                           GET/PUT/DELETE
inventory-orders/[id]/order-lines/route.ts               GET/POST
inventory-orders/[id]/feedbacks/route.ts                 POST
inventory-orders/[id]/send-to-partner/route.ts           POST
inventory-orders/[id]/tasks/route.ts                     GET/POST
inventory-orders/[id]/tasks/[taskId]/route.ts            GET/PUT/DELETE
```

### Where image extraction sits today
- **Entry button is on the wrong page**: `src/admin/routes/orders/inventory/page.tsx:491-497` — a `<Button>Import inventory</Button>` that `navigate("/inventory/import-from-image")`. It lives on the Inventory **Orders** list, not the Inventory route.
- AI extraction endpoint is **AI-centric**, not inventory-centric: `src/api/admin/ai/image-extraction/route.ts` (`/admin/ai/image-extraction`).
- A separate **manual** photo→raw-material binding (no AI, #730) lives at `src/api/admin/medias/file/[id]/raw-material/route.ts` (`/admin/medias/file/:id/raw-material`, GET/POST/DELETE).
- The admin *UI* page already exists at `src/admin/routes/inventory/import-from-image/` (+ `recent-extractions/`).

### Nesting convention (file-system routing)
`/<resource>/[id]/<sub>/route.ts` → `/resource/:id/sub`; deeper via `[id]/<sub>/[subId]/route.ts` (e.g. `inventory-items/[id]/rawmaterials/[rawMaterialId]`).

### What "move it under Inventory" means — Option A (LOCKED)
1. **UI**: relabel `orders/inventory/page.tsx:491` "Import inventory" → **"Import From Image"** and surface it from the **Inventory** route (next to the inventory item) instead of the Inventory Orders list. Repoint the `navigate(...)` target.
2. **API**: relocate from `/admin/ai/image-extraction` to `POST /admin/inventory-items/[id]/import-from-image`, following `send-to-partner`/`labels`/`split`. Update the admin hook in `src/admin/hooks/api/ai.ts`.

**Open question** (decide before building): the "create from scratch" flow has no `[id]` — keep a non-nested `POST /admin/inventory-items/import-from-image` for it, or always require an item context? (Option B — nesting under `inventory-orders/[id]` — was considered and rejected.)

---

## Task 3 — Visual flow for inventory-order events/messages + partner-API parity

### Visual-flow event trigger (already wired)
- `src/subscribers/visual-flow-event-trigger.ts:1-283` — matches emitted events against active flows (`trigger_type="event"`, `status="active"`), runs `executeVisualFlowWorkflow` async (20-104). Matching precedence (113-131): `event_pattern` (shell wildcards) → `event_types[]` → `event_type` (legacy).
- **Inventory-order events already registered** (212-215):
  - `inventory_orders.inventory-orders.created`
  - `inventory_orders.inventory-orders.updated`
  - `inventory_orders.inventory-orders.deleted`
- Executor: `src/workflows/visual-flows/execute-visual-flow.ts:669-704` (load → init → execute ops along connection graph 438-506 → complete; diamond-join dedup).
- Message ops:
  - `src/modules/visual_flows/operations/send-whatsapp.ts:29-178` (`send_whatsapp`; template/text/image/interactive; routes to SocialPlatform by country code; persists to messaging; dedup by (context_type, context_id); partner linking/`require_partner`).
  - `src/modules/visual_flows/operations/send-email.ts:5-107` (`send_email`; template or custom body; interpolates flow data chain).

### Inventory-order model & lifecycle
- `src/modules/inventory_orders/models/order.ts:8-15` — status enum: `Pending` (default), `Processing`, `Shipped`, `Delivered`, `Cancelled`, `Partial`.
- Events emit automatically via `MedusaService`:
  - create: `src/workflows/inventory_orders/create-inventory-orders.ts` (`createInvWithLines`, 67-106) → `…created`
  - update/status change: `src/workflows/inventory_orders/update-inventory-order.ts:25-47` → `…updated`
- **No new event type required** — created/updated/deleted already cover every lifecycle transition; status transitions ride the `…updated` event.

### Partner APIs — end-to-end marking (`src/api/partners/inventory-orders/`)
| Method | Route | Transition | Action |
|---|---|---|---|
| GET | `/partners/inventory-orders` (`route.ts:135`) | — | list assigned orders (filter status/offset/limit) |
| GET | `/partners/inventory-orders/[orderId]` | — | full detail incl. `partner_info.partner_status` |
| POST | `/partners/inventory-orders/[orderId]/start` (`start/route.ts:86`, calls `updateInventoryOrderWorkflow` status `Processing` 163-175) | Pending → Processing | mark received; stamps `partner_started_at`; completes "partner-order-received" task |
| POST | `/partners/inventory-orders/[orderId]/complete` (`complete/route.ts:128`; wf `partner-complete-inventory-order.ts`) | Processing → Shipped/Delivered | per-line fulfillment `{lines:[{order_line_id,quantity}], deliveryDate?, trackingNumber?, notes?}`; partial supported, returns `fullyFulfilled` |
| POST | `/partners/inventory-orders/[orderId]/submit-payment` (`submit-payment/route.ts:25`) | — | `{amount, payment_type?, payment_date?, note?, attachments?}` |

Partner status path: `assigned` → `in_progress` (start) → `completed` (complete). `partner_started_at` / `partner_completed_at` timestamps.

### Net for Task 3
The plumbing exists end-to-end: partner start/complete/submit-payment mutate the order → `…updated` fires → the event-trigger subscriber already lists the inventory-order events → a flow can `send_whatsapp`/`send_email`. **Remaining work is product/config, not infra:** author the actual inventory-order flow(s) (templates per transition), confirm the trigger config uses `inventory_orders.inventory-orders.updated` (+ a `status`-changed filter, since update fires on any field), and parity-test the partner endpoints. Watch-out: `…updated` fires on metadata-only changes too — flows must guard on the status delta to avoid spurious messages.

---

## Task 4 — Shiprocket for stock movement on partner completion (#772)

Partner completing an inventory order has **no real shipment/label** — `trackingNumber` is free text. Full provider map in `SHIPROCKET_PROVIDER_CODEMAP.md`; summary of the gap:

- Flow: `src/workflows/inventory_orders/partner-complete-inventory-order.ts` (input 16-28; fulfillment entries 140-219; metadata/tracking 338-356). Route `src/api/partners/inventory-orders/[orderId]/complete/route.ts:114-126`.
- Today: `trackingNumber` → `metadata.partner_tracking_number` + `partner_delivery_history[]` + custom `line_fulfillments` metadata. No carrier shipment, no `sr_order_id`/`shipment_id`/`label_url`.
- Have: `ShiprocketClient.createShipment()` (`src/modules/shipping-providers/shiprocket/client.ts:304-404`) + admin precedent `POST /admin/orders/:id/shiprocket-label`.
- Addresses sufficient: to = `inventory_orders.shipping_address`; from = stock location (`*_stock_location_id` → `stock_location.address.*`, pickup name from `metadata.shiprocket_pickup_location`).
- **Opt-in**: shipment generation is an OPTION the partner chooses (toggle/action) — keep the free-text path when off; default off.
- **First-time pickup bootstrap**: before `createShipment()`, `listPickupLocations()` → if the partner/stock-location pickup isn't registered, follow-up `registerPickupLocation()` from the source address, then stamp `stock_location.metadata.shiprocket_pickup_location`. If the source address itself is missing, block with a clear "add pickup address" error.
- Storage decision: create a Medusa core `fulfillment` (reuse existing label/track routes) vs. extend the custom `line_fulfillment` with carrier refs. Partial-delivery: per-completion shipment vs. ship-once-fully-fulfilled.
- Watch-outs: pre-registered pickup location required (hence list→register); `registerPickupLocation` is async (pickup may be non-`shippable` briefly); label best-effort (`getLabel()` follow-up); JWT TTL; COD vs prepaid `payment_mode`.

---

## Quick file index
- Route: `src/api/admin/ai/image-extraction/route.ts`
- Mastra wf: `src/mastra/workflows/imageExtraction/index.ts`; agent `src/mastra/agents/index.ts:114-126`; vision model `src/mastra/providers/openrouter.ts:319-349`
- Role registry: `src/mastra/services/ai-platforms.ts` (`getAiPlatformForRole` 142-239, `makeRoleAiGenerate` 403-451, `AI_ROLES` 644-651)
- Inventory routes: `src/api/admin/inventory-items/**`, `src/api/admin/inventory-orders/**`
- Visual flow: `src/subscribers/visual-flow-event-trigger.ts`, `src/workflows/visual-flows/execute-visual-flow.ts`, `src/modules/visual_flows/operations/{send-whatsapp,send-email}.ts`
- Inventory-order module: `src/modules/inventory_orders/models/order.ts`, `src/workflows/inventory_orders/**`
- Partner APIs: `src/api/partners/inventory-orders/**`
</content>
</invoke>
