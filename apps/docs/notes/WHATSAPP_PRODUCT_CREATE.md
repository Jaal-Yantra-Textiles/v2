# WhatsApp Product Creation for Partners

> Status: **IN PROGRESS** — W1 already shipped; W2 (workflow + tests) landed 2026-05-30.
> Date: 2026-05-29 (design), 2026-05-30 (W2 update)
> Owner: Saransh
> Companion to `WEBHOOK_SETUP_GUIDE.md` (Meta WhatsApp wiring) and `PARTNER_API_PARITY.md` (the quick-create endpoint we reuse).

## Build progress

| PR | Status | Notes |
|----|--------|-------|
| W1 — media rehost helper | ✅ **already shipped** | `downloadAndSaveWhatsAppMedia` at `apps/backend/src/workflows/whatsapp/whatsapp-media-helper.ts:239`. Handles Bearer auth on Meta presigned URL + base64 round-trip for file-s3 provider (the second one had bitten us before — well-documented in the source). |
| W2 — `createDraftProductFromExtractionWorkflow` | ✅ shipped 2026-05-30 | `apps/backend/src/workflows/whatsapp/create-draft-product-from-extraction.ts`. 4 steps: resolve store → rehost media → build product input → invoke `createProductsWorkflow` with `status: DRAFT`. 4 integration tests passing. |
| W3 — webhook emits `whatsapp.message_received` event + subscriber registration | ⏳ next |
| W4 — `seed-partner-product-create-flow.ts` for one pilot partner | ⏳ |
| W5 — Confirm/Edit/Cancel flow + roll-out | ⏳ |
| W6 — Polish (caption-only, photo-only, dedupe verify) | ⏳ |

## Goal

A partner with a live storefront sends a photo + caption to our WhatsApp Business number. We extract product fields, ask them to confirm via an interactive button, and create the product as **DRAFT** on their storefront. Same intent as the existing `POST /partners/stores/:id/products/quick` route, just driven by WhatsApp instead of a web form.

For a partner sitting at a loom in the field, "snap a photo, type one line, hit send" is the lowest possible activation cost compared to opening partner-ui on their phone.

## What's already built (90% of the stack)

The infrastructure was put in place for production-run management over WhatsApp and is directly reusable:

| Piece | Where |
|---|---|
| Inbound webhook (GET verify + POST receive) | `apps/backend/src/api/webhooks/social/whatsapp/route.ts` |
| Meta signature check (`HMAC-SHA256` of body) | Same route |
| Parsed message envelope (text / image / video / interactive) | `parseWebhookMessage()` in same route |
| Async dispatch | `handleIncomingMessage()` at `apps/backend/src/workflows/whatsapp/whatsapp-message-handler.ts:160` |
| Partner resolution by phone | `resolvePartnerByPhone()` in same file — checks `partner.whatsapp_number` then any `partner_admin.phone`, auto-verifies first contact |
| Conversation + message persistence | `persistInboundMessage()` + `persistOutboundMessage()` in same file; `MessagingMessage` model under `apps/backend/src/modules/messaging/` |
| Outbound text + interactive reply | `WhatsAppService.sendTextMessage` / `sendInteractiveMessage` under `apps/backend/src/modules/social-provider/whatsapp-service.ts` |
| WhatsApp media URL resolution | `whatsapp-service.getMediaUrl(mediaId)` — fetches short-lived Meta presigned URL |
| Per-partner credentials (multi-tenant numbers) | `SocialPlatform` + `SocialPlatformBinding` under `apps/backend/src/modules/socials/` |
| Vision-capable extraction | `apps/backend/src/mastra/agents/textileExtractionAgent.ts` — OpenRouter free Gemini, returns title/fabric/colors/suggested price |
| S3 file module | `apps/backend/src/modules/custom-s3-provider/` |
| Quick-create endpoint | `apps/backend/src/api/partners/stores/[id]/products/quick/route.ts` — title + price + images + optional stock |

## What's missing (the build)

Three concrete gaps. All other infrastructure already exists.

### Gap 1 — Intent classifier inside `handleIncomingMessage()`

`handleIncomingMessage()` today routes to the production-run lifecycle. We add an early branch:

```
hasImage(message) && hasCaption(message)
  → enter product-create flow
```

No LLM intent yet. Rule is good enough because (a) the only people who can talk to us are verified partners, (b) we show a Confirm/Edit/Cancel button before writing, so false positives never become published products. If a partner sends a photo of their kid by accident, they tap Cancel and nothing happens.

Edge case: photo without caption → reply "Add a one-line caption (name + price) and re-send."

### Gap 2 — WhatsApp media re-host helper

Meta media URLs are presigned and short-lived (~5 min). Quick-create takes `images: string[]` (public URLs), so we must download + re-upload to S3 first.

New helper (~40 lines):
```
src/workflows/whatsapp/handlers/rehost-media.ts
  rehostWhatsAppMedia(scope, mediaId): Promise<{ url: string; mime_type: string }>
    1. wa.getMediaUrl(mediaId) → { url, mime_type }
    2. fetch(url, { headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` } })  // Meta requires the token even on the presigned URL
    3. upload via Medusa's file module (`Modules.FILE`) → public S3 URL
    4. return { url: s3_url, mime_type }
```

The Bearer-token-on-presigned-URL gotcha is real; if we forget it, the download returns 401.

### Gap 3 — Glue handler + confirm flow

New file: `src/workflows/whatsapp/handlers/product-create-handler.ts`

```
handleProductCreateMessage(scope, message, partner)
  ├─ extract image mediaId(s) + caption
  ├─ rehost each image (Gap 2)
  ├─ run textileExtractionAgent on (caption, images[0])
  ├─ stash draft state on the conversation:
  │     conversation.metadata.pending_product = {
  │       extracted: { title, description, suggested_price, ... },
  │       images: [s3_url, ...],
  │       store_id: partner.default_store_id,
  │     }
  └─ reply with interactive buttons:
       body: "Got it. Create this draft?\n\n*{title}*\n₹{suggested_price}\nFabric: {fabric_type}"
       buttons: [Confirm, Edit, Cancel]
```

Then a tiny dispatcher inside `handleIncomingMessage()`:

```
if (message.interactive?.button_reply?.id starts with "product_create:")
  → handleProductCreateConfirmation(scope, message, partner)
```

`handleProductCreateConfirmation`:
- **Confirm:** call `POST /partners/stores/:id/products/quick` (or invoke `createProductsWorkflow` directly, same code path) with `status: DRAFT`. Reply with the admin URL: `https://admin.jyt.dev/partners/{partnerId}/products/{productId}`.
- **Edit:** reply "Send the corrected line (e.g. `Title — ₹price`)." → next free-text message overwrites `pending_product`, re-prompts Confirm.
- **Cancel:** clear `pending_product` from conversation metadata; "OK, nothing created."

DRAFT is non-negotiable for v1. Extraction quality is unknown across partners' captioning styles; never write `PUBLISHED` until they've reviewed in admin or partner-ui.

## Wire-level message flow

```
Partner                Meta                 Our backend
   │  📷 + "Saree silk ₹4500" │                     │
   │ ──────────────────────► │                     │
   │                         │   POST webhook       │
   │                         │ ──────────────────► │
   │                         │                     │ 200 OK (immediate)
   │                         │ ◄────────────────── │
   │                         │                     │ ⤷ async:
   │                         │                     │    persist msg
   │                         │                     │    rehost image → S3
   │                         │                     │    textileExtractionAgent
   │                         │                     │    stash pending_product
   │                         │   send interactive   │
   │                         │ ◄────────────────── │
   │  [Confirm][Edit][Cancel]│                     │
   │ ◄────────────────────── │                     │
   │     tap Confirm         │                     │
   │ ──────────────────────► │                     │
   │                         │ ──────────────────► │ createProductsWorkflow
   │                         │                     │   status: DRAFT
   │                         │   send admin link    │
   │                         │ ◄────────────────── │
   │  "https://admin.../p_…" │                     │
```

## Out of scope for v1

- **Variants.** Quick-create makes one variant. Multi-variant via WhatsApp is a v2 thing; partners with size runs go through the web flow.
- **Inventory levels.** Quick-create accepts `stock_quantity` but we don't ask via WhatsApp in v1. Default to manage_inventory=false; partner sets stock from admin.
- **Multi-image carousel.** v1 attaches only the first image as both `thumbnail` and `images[0]`. Multi-image needs partner to send all photos in one Meta message (album), which Meta delivers as N separate webhook hits — handling that needs a debounce window. Defer.
- **Voice notes.** Caption-only for v1. Voice → Whisper → caption is a v2 add.
- **English-only.** Extraction agent is English-prompted. Hindi/regional captions probably work via Gemini but we don't optimise for them.

## Data + schema changes

**None required.** Everything reuses existing models:
- `MessagingConversation.metadata.pending_product` — JSON blob, no migration needed
- `MessagingMessage` rows for the inbound photo + outbound interactive — already wired
- New product written via `createProductsWorkflow` like every other product

The whole feature is one new handler file + one new helper + one branch in the existing dispatcher.

## PR sequence

| PR | What |
|---|---|
| **W1** | `rehost-media.ts` helper + unit test (mocked Meta presigned URL + mocked S3 upload). No webhook integration yet. |
| **W2** | `product-create-handler.ts` — extraction + pending_product stash + interactive reply. Dispatcher branch in `handleIncomingMessage()`. Reply only; no product write yet. |
| **W3** | Confirm/Edit/Cancel handler. Writes `status: DRAFT` product via `createProductsWorkflow`. Replies with admin link. End-to-end. |
| **W4** | Polish: handle "photo with no caption", "caption with no photo", duplicate-detection (same `wa_message_id` twice from Meta retries — `MessagingMessage` already dedupes, so this is just verifying we don't double-create). |

Each PR is small enough to review in one sitting and deployable independently. W1+W2 don't change partner-visible behavior at all; W3 turns the feature on.

## Test plan (per PR)

- **W1:** Unit test the rehost helper with a 1KB fixture image. Confirm S3 URL returned, mime_type preserved.
- **W2:** Integration test — mock a webhook POST with image + caption, assert we reply with an interactive containing the extracted title and price.
- **W3:** Integration test — webhook POST with image + caption → reply → simulated Confirm button reply → assert product exists in DB with `status: draft` + the image URL + the partner's default sales_channel + price as a variant.
- **W4:** Edge cases above. Manual smoke from a real WhatsApp number against staging.

## Open risks

1. **Extraction quality drift.** Free Gemini tier on OpenRouter has variable rate limits and occasionally returns malformed JSON. Mitigated by `textileExtractionAgent`'s retry chain, but worth a metric (count of `extraction_failed` events) once shipped.
2. **Meta media token rotation.** WhatsApp access tokens expire. Already a known risk for production-run flow; same renewal path applies. No new exposure.
3. **Partner accidentally sending sensitive photos.** WhatsApp is end-to-end on the client side, but once Meta delivers to us we're a data controller. Document in privacy policy that media sent to our WhatsApp number is processed for product creation and stored.
4. **Storefront leak from wrong-partner resolution.** `resolvePartnerByPhone()` matches first by `partner.whatsapp_number`, then by any `partner_admin.phone`. If two partners share an admin's phone (rare but possible), the first hit wins. Same risk as production-run flow today; no new exposure.

## Effort estimate

Two days for W1 + W2 + W3 + tests, assuming no surprises with the Meta media download auth header. W4 is another half day after we watch a few real messages flow through.

---

# Visual-flow-native architecture (recommended path)

> **2026-05-29 update:** investigated the visual-flow engine. It's a much better fit for this feature than the hardcoded-handler approach above. The handler-only path is still valid as a fallback, but the flow-native path costs ~1 extra day of build, and in return we get full execution audit logs, no-code admin tweaks, and the same shape as the existing outbound WhatsApp flow that already ships in production.

## Why visual-flow over a hardcoded handler

The `visual_flows` module is more mature than I assumed:

| Capability | Status |
|---|---|
| Event-triggered flows (not just scheduled) | ✅ shipped — `apps/backend/src/subscribers/visual-flow-event-trigger.ts` listens to a curated event list and matches by pattern, exact name, or array |
| `ai_extract` operation with schema-fields | ✅ shipped — `apps/backend/src/modules/visual_flows/operations/ai-extract.ts` runs OpenRouter, parses JSON output, returns typed object |
| `send_whatsapp` operation with template/interactive | ✅ shipped — used by `seed-partner-payment-status-flow.ts` for outbound templates |
| `trigger_workflow` with payload + completion-wait | ✅ shipped — invokes any Medusa workflow by name |
| `condition` branching | ✅ shipped |
| `execute_code` for inline JS (partner lookup) | ✅ shipped |
| Full execution log with input/output per node | ✅ shipped — `VisualFlowExecutionLog` |
| Admin UI to edit flow graph | ✅ shipped — `/admin/visual-flows` + React Flow editor |
| Seed script pattern for canonical flows | ✅ shipped — `apps/backend/src/scripts/seed-partner-payment-status-flow.ts` |

There's an existing production WhatsApp visual flow: **"Partner WhatsApp — Payment Submission Status"** (outbound, event-triggered on `payment_submission.*`). It's the prior art we mirror.

The only piece we add to the engine itself is **emitting an inbound event** from the webhook. Today the webhook calls `handleIncomingMessage()` directly; we change it to *also* emit `whatsapp.message_received` so flows can subscribe.

## Revised flow

```
Inbound WhatsApp msg (photo + caption)
  │
  ▼
/api/webhooks/social/whatsapp/route.ts
  │  → emit("whatsapp.message_received", { from, partner_id, type, caption, media_ids, message_id, conversation_id })
  │
  ▼
visual-flow-event-trigger subscriber
  │  matches flows with trigger_config.event_pattern = "whatsapp.message_received"
  │
  ▼
┌──────────────────────────────────────────────────────────┐
│  Flow: "Partner WhatsApp — Product Create"               │
│                                                          │
│  ① condition: payload.type === "image" && caption.length │
│       │ false → END                                       │
│       │ true                                              │
│  ② execute_code: rehost media via WhatsApp service        │
│       └→ { images: [s3_url, ...], mime_type }            │
│  ③ ai_extract: schema_fields = [title, fabric_type,       │
│       suggested_price_inr, colors[], description]         │
│       input = caption + image_url from step ②            │
│  ④ trigger_workflow: createDraftProductFromExtractionWorkflow │
│       input = { partner_id, store_id, extracted, images } │
│       wait_for_completion = true                         │
│       └→ { product_id, admin_url }                       │
│  ⑤ send_whatsapp: interactive Confirm/Edit/Cancel         │
│       body templated with extracted fields                │
│       button payloads: product_create:{action}:{product_id} │
└──────────────────────────────────────────────────────────┘

Partner taps Confirm
  │
  ▼  (comes back as another inbound webhook → same event)
visual-flow-event-trigger
  │
  ▼
┌──────────────────────────────────────────────────────────┐
│  Flow: "Partner WhatsApp — Product Confirm"              │
│                                                          │
│  ① condition: payload.type === "interactive" &&           │
│       payload.button_id startsWith "product_create:"     │
│  ② execute_code: parse button_id → { action, product_id } │
│  ③ condition: action === "confirm"                        │
│       │ confirm → publish (status: draft → published)    │
│       │ edit    → reply with "send corrected line"       │
│       │ cancel  → delete draft product                   │
│  ④ trigger_workflow: appropriate action                   │
│  ⑤ send_whatsapp: confirmation text + admin link          │
└──────────────────────────────────────────────────────────┘
```

Two flows, not one — keeps each flow's purpose obvious and lets the admin pause "create" without breaking "confirm" handling.

## What's actually new code

Even with the flow-native approach, the engine already does most of the work. New code:

| File | Purpose | LOC |
|---|---|---|
| `apps/backend/src/api/webhooks/social/whatsapp/route.ts` (edit) | After `handleIncomingMessage()`, also emit `whatsapp.message_received` with the parsed envelope | +10 |
| `apps/backend/src/subscribers/visual-flow-event-trigger.ts` (edit) | Add `"whatsapp.message_received"` to the event registry list | +1 |
| `apps/backend/src/workflows/whatsapp/handlers/rehost-media.ts` (new) | The download-from-Meta + re-upload-to-S3 helper from Gap 2 above. Called from the flow's `execute_code` node | ~40 |
| `apps/backend/src/workflows/products/create-draft-product-from-extraction.ts` (new) | Thin workflow wrapping `createProductsWorkflow` with `status: DRAFT` + extracted-field mapping | ~60 |
| `apps/backend/src/scripts/seed-partner-product-create-flow.ts` (new) | Seed both flows (Create + Confirm) per partner, mirroring `seed-partner-payment-status-flow.ts` | ~250 |

**No new visual-flow operation types needed.** All five nodes per flow use existing operations.

The handler-only `product-create-handler.ts` from the original plan goes away — its logic is now distributed across `execute_code` (rehost), `ai_extract` (extraction), `trigger_workflow` (product write), `send_whatsapp` (reply).

## Tradeoffs vs. the hardcoded-handler path

| | Hardcoded handler (Plan A) | Visual flow (Plan B — recommended) |
|---|---|---|
| Build time | ~2 days | ~3 days |
| Observability | Console logs + Medusa logger | Full per-node input/output in `VisualFlowExecutionLog` table, surfaced in admin UI |
| Tweaking the prompt or schema | PR + deploy | Admin edits `ai_extract.options.schema_fields` live |
| Pausing the feature | Feature flag + redeploy | Toggle flow `status: inactive` in admin, takes effect immediately |
| Adding a new node (e.g. "post to internal Slack on each new draft") | New code path | Drop a `send_notification` node in the editor |
| Partner customisation per-partner | Not possible | Seed script clones the flow per partner; admin can tweak per-partner copies |
| Per-message debugging by the operator | Read logs, correlate by message_id | Open the execution record, see exactly which node failed and with what input |
| Cost when extraction fails | Console error | Failed execution + error string in audit, easy to query "how often did `ai_extract` fail this week" |

The big wins are operational, not architectural. The build cost difference is one day. For something we're going to iterate on (extraction quality WILL need tuning across partners with different captioning styles), inspectable execution > slightly faster ship.

## Revised PR sequence

| PR | What | Notes |
|---|---|---|
| **W1** | `rehost-media.ts` helper + unit test | Unchanged from Plan A — needed either way |
| **W2** | `create-draft-product-from-extraction.ts` workflow + integration test | Direct workflow test, no flow involvement yet |
| **W3** | Webhook emits `whatsapp.message_received` event + register in subscriber | No flow exists yet, so this is a no-op in prod until W4 lands |
| **W4** | `seed-partner-product-create-flow.ts` — seeds the "Create" flow for one pilot partner. End-to-end alive behind that single seeded flow | Pilot partner only; other partners get the flow when W5 ships |
| **W5** | Seeds the "Confirm" flow + Confirm/Edit/Cancel handling. Seed script accepts `--all-partners` flag to roll out | Feature now usable by every live storefront partner |
| **W6** | Polish: photo-only / caption-only edges, duplicate webhook dedup (already handled by `MessagingMessage`, just verify), admin UI quick-link from execution → resulting product | Optional but valuable for operator UX |

Each PR remains independently shippable. W1+W2 don't touch user-facing behavior. W3 is a single line + an event we don't listen to yet. W4 turns the feature on for one partner, which is the safest possible cutover.

## Open questions for visual-flow path

1. **Do we replicate the flow per partner, or share one flow that branches on `partner_id`?** Payment-status flow is shared. For product create I'd lean shared too — extraction prompt is the same across partners, only `partner_id` and `store_id` differ. Per-partner clones only become useful when we want per-partner extraction tuning, which is a v2 problem.

2. **Where does `pending_product` state live?** Plan A stashed it on `conversation.metadata`. With flows, we have two options:
   - (a) Same — `execute_code` node reads/writes `MessagingConversation.metadata.pending_product`. Continuity across the two flows.
   - (b) The draft product itself IS the pending state — we create it as `status: draft` immediately, Confirm just flips to `published`, Cancel deletes it. No extra state needed.
   I'd go with (b). It's simpler and the draft product is already addressable by ID, which we bake into the Confirm button payload.

3. **What if the partner sends a follow-up free-text edit?** ("Make it ₹3800 instead.") Handling this needs a third flow triggered when `payload.type === "text"` AND a draft product exists for that conversation. Reasonable v2 add; v1 just supports Confirm/Cancel and tells the partner to re-shoot if they want changes.

## Bottom line

Visual-flow path is the right call. Plan A and Plan B share PRs W1 + W2 (helper + workflow). The split happens at W3 — instead of wiring a hardcoded handler, we wire an event emit and let the flow engine own orchestration. The same `createProductsWorkflow` runs at the bottom either way.

Recommend going Plan B unless we hit a snag wiring the inbound event into the subscriber registry, in which case Plan A is a known-good fallback we can swap in without losing W1/W2.
