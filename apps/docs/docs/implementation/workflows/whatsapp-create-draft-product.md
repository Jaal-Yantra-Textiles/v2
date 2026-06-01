---
title: "WhatsApp Product Create — Draft Workflow"
sidebar_label: "WhatsApp Create Draft Product"
sidebar_position: 11
---

# WhatsApp Product Create — Draft Workflow

`createDraftProductFromExtractionWorkflow` is the Medusa workflow that turns a WhatsApp message (photo + caption) into a **draft** product on the partner's storefront. It is the "create" half of the WhatsApp Product Create feature (W2 from the design doc `notes/WHATSAPP_PRODUCT_CREATE.md`); the "confirm/edit/cancel" half lives in a separate flow that follows.

This is the **inbound** counterpart to the existing [Partner WhatsApp — Production Run Flow](./whatsapp-partner-run-flow) (which is **outbound** — admin events → partner via WhatsApp). Same engine, opposite direction.

**Source:** `apps/backend/src/workflows/whatsapp/create-draft-product-from-extraction.ts`
**Tests:** `apps/backend/integration-tests/http/whatsapp-create-draft-product.spec.ts` (4 specs, ~12s)
**Design doc:** `apps/docs/notes/WHATSAPP_PRODUCT_CREATE.md`

---

## Where it fits

```
Partner sends 📷 + "Saree silk ₹4500"
        │
        ▼
┌────────────────────────────────────────────────┐
│ /api/webhooks/social/whatsapp (POST)           │
│  - HMAC signature check                        │
│  - parseWebhookMessage()                       │
│  - returns 200 OK to Meta immediately          │
│  - emit("whatsapp.message_received", …)    ✅W3 │
└─────────────────────┬──────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────┐
│ visual-flow-event-trigger subscriber           │
│  matches active flows by event_pattern         │
└─────────────────────┬──────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────┐
│ Visual flow:                                   │
│ "Partner WhatsApp — Product Create"            │
│                                                │
│  1. condition (hasImage && hasCaption)         │
│  2. execute_code: rehost media                 │
│  3. ai_extract: title / price / fabric / …     │
│  4. trigger_workflow:                          │
│     ──────────────────────────────────────╮    │
│     │ createDraftProductFromExtraction…   │ ← THIS DOC
│     ──────────────────────────────────────╯    │
│  5. send_whatsapp (interactive):               │
│     ✅ Confirm  /  🗑️ Cancel              ✅W5 │
└────────────────────────────────────────────────┘
                      │
                      ▼
              prod_… draft product on the
              partner's storefront, admin link
              sent back via WhatsApp.
```

The workflow is intentionally **callable in three ways**, in order of preference:

1. **From a visual flow's `trigger_workflow` operation** (recommended). The flow gets the per-step execution log for free, the admin can tweak the extraction prompt without redeploy, and a future partner-customisable flow is one seed away.
2. **From a hardcoded TypeScript handler** in `handleIncomingMessage()`. Use this only if the visual-flow path is blocked.
3. **From a test** via `workflow(container).run({ input })` — see the integration test file.

The workflow doesn't care which caller it has; the four steps are identical.

---

## Input / Output

```typescript
export type CreateDraftProductFromExtractionInput = {
  partner_id: string
  partner_name: string

  // WhatsApp media IDs from the inbound message. Pass [] for caption-only.
  // The rehost step downloads each via downloadAndSaveWhatsAppMedia and
  // drops failed downloads silently.
  media_ids: string[]

  // Subset of fields the textile extraction agent returns. Lenient
  // because OpenRouter free-tier models occasionally drop fields.
  // Only `title` is required; missing `suggested_price` defaults to 0.
  extracted: {
    title?: string | null
    description?: string | null
    suggested_price?: number | null
    fabric_type?: string | null
    colors?: string[] | null
  }

  // Optional caption to stash on the file metadata for audit.
  caption?: string | null
}

export type CreateDraftProductFromExtractionResult = {
  product_id: string                // prod_…
  product_title: string             // echoed back to partner in the confirm
  admin_url: string                 // "/app/products/prod_…"
  rehosted_image_urls: string[]     // stable S3 URLs (NOT Meta presigned)
  status: "draft"                   // always
}
```

---

## The four steps

Each step is a `createStep` with its own input/output, so the workflow execution log surfaces exactly which step failed if it does.

### 1. `wa-product-create-resolve-store`

`query.graph` the partner → store + sales channel + supported_currencies. Picks the default currency (or the first supported currency if none is marked default).

Throws if the partner has no store, the store has no default sales channel, or the store has no supported currencies. These are configuration errors — a partner without a configured storefront can't have products written to it.

### 2. `wa-product-create-rehost-media`

For each `media_id`, calls the already-shipped `downloadAndSaveWhatsAppMedia` helper at `apps/backend/src/workflows/whatsapp/whatsapp-media-helper.ts:239`. That helper:

- Calls `wa.getMediaUrl(mediaId)` for Meta's short-lived presigned URL
- Downloads the binary using a Bearer token (Meta requires the access token even on the presigned URL — `whatsapp-service.downloadMedia` handles this)
- Uploads via `uploadAndOrganizeMediaWorkflow` into the partner's per-tenant WhatsApp media folder (or an override folder if passed)
- Returns a stable S3 URL with `mimeType` and `folderId`

Per-image failures are non-fatal: the step accumulates only successful URLs and continues. A partner sending one good photo + one corrupted photo still gets a product.

### 3. `wa-product-create-build-input`

Composes the same `productInput` shape as the partner quick-create route (`/partners/stores/:id/products/quick/route.ts`), but with two non-negotiable overrides:

- `status: ProductStatus.DRAFT` — **always**, regardless of caller input. A misextracted title or stray photo must never become a live product.
- `metadata.created_via: "whatsapp"` plus `wa_fabric_type` / `wa_colors` — admin can filter or audit WhatsApp-created products via standard product metadata queries.

Throws `INVALID_DATA` if `extracted.title` is missing or whitespace-only — that's the one extracted field without a sane default.

### 4. `wa-product-create-invoke-create`

Runs Medusa's `createProductsWorkflow` with the built input. Returns `{ product_id, product_title }`.

---

## Usage examples

### From a visual flow (recommended)

Add a `trigger_workflow` node to the inbound flow:

```json
{
  "operation_type": "trigger_workflow",
  "operation_key": "create_draft_product",
  "options": {
    "workflow_name": "create-draft-product-from-extraction",
    "wait_for_completion": true,
    "input": {
      "partner_id": "{{ resolve_partner.id }}",
      "partner_name": "{{ resolve_partner.name }}",
      "media_ids": "{{ $trigger.payload.media_ids }}",
      "caption": "{{ $trigger.payload.caption }}",
      "extracted": {
        "title": "{{ ai_extract.object.title }}",
        "description": "{{ ai_extract.object.description }}",
        "suggested_price": "{{ ai_extract.object.suggested_price }}",
        "fabric_type": "{{ ai_extract.object.fabric_type }}",
        "colors": "{{ ai_extract.object.colors }}"
      }
    }
  }
}
```

Downstream nodes can read the result chain — `{{ create_draft_product.workflow_result.product_id }}`, `{{ create_draft_product.workflow_result.admin_url }}`, etc. — to template the WhatsApp confirmation reply.

### From a TypeScript handler

```typescript
import { createDraftProductFromExtractionWorkflow }
  from "../../workflows/whatsapp/create-draft-product-from-extraction"

const { result, errors } = await createDraftProductFromExtractionWorkflow(scope).run({
  input: {
    partner_id: partner.id,
    partner_name: partner.name,
    media_ids: message.media_ids,
    caption: message.text,
    extracted: {
      title: extracted.title,
      description: extracted.description,
      suggested_price: extracted.suggested_price,
      fabric_type: extracted.fabric_type,
      colors: extracted.colors,
    },
  },
  throwOnError: false,
})

if (errors?.length) {
  // Step error — surface to WhatsApp as a polite ask-again
  await whatsapp.sendTextMessage(
    message.from,
    "I couldn't create the product. Send a clear photo and a one-line caption."
  )
  return { handled: true, error: "wa_product_create_failed" }
}

await whatsapp.sendInteractiveMessage(message.from, {
  type: "button",
  body: {
    text: `Draft created: *${result.product_title}*\nReview & publish: ${ADMIN_HOST}${result.admin_url}`,
  },
  action: {
    buttons: [
      { type: "reply", reply: { id: `product_create:confirm:${result.product_id}`, title: "Publish" } },
      { type: "reply", reply: { id: `product_create:edit:${result.product_id}`,    title: "Edit"    } },
      { type: "reply", reply: { id: `product_create:cancel:${result.product_id}`,  title: "Cancel"  } },
    ],
  },
})
```

### From an integration test

Bootstrap a partner with store + sales channel + region (the existing helper pattern), then invoke directly:

```typescript
const { result } = await createDraftProductFromExtractionWorkflow(container).run({
  input: {
    partner_id: partner.partnerId,
    partner_name: partner.partnerName,
    media_ids: [],  // no media → caption-only test
    extracted: {
      title: "Handwoven Cotton Kurta",
      description: "Soft cotton, hand-loom Kashmir.",
      suggested_price: 4500,
      fabric_type: "cotton",
      colors: ["white", "indigo"],
    },
  },
})

expect(result.product_id).toMatch(/^prod_/)
expect(result.status).toBe("draft")
```

For error-path assertions, pass `throwOnError: false` and inspect `errors` — Medusa workflows don't throw on step failures; they accumulate to the result envelope.

---

## Decisions worth knowing

### DRAFT is non-negotiable

The workflow ignores any caller-supplied `status` and writes `DRAFT`. Reasons:

- The textile extraction agent runs on a free OpenRouter model. Drift in extraction quality across partners' captioning styles is unknown. The first publish should be a human decision.
- A "Confirm" button reply (the W5 PR) can flip `DRAFT → PUBLISHED` with `updateProductsWorkflow`. That's one update vs. forever risking a wrong product on the live storefront.
- DRAFT products are still partner-visible in admin and partner-ui. Nothing is hidden.

### Metadata stamping (`created_via: "whatsapp"`)

Three uses:

- Admin can filter/sort products by source.
- A future cleanup script can target abandoned drafts.
- The audit trail survives even if the visual-flow execution log is purged.

### Empty `media_ids` is allowed

Caption-only product creation is a valid v1 path — the partner can send a name + price without a photo and add an image later from admin. The product is created without `images[]`, `thumbnail` falls through to undefined.

### Failed media downloads drop silently

Per-image failures don't fail the whole workflow because:

- Meta presigned URLs are time-limited; we may race the expiry on retry.
- The partner experience is "I sent 3 photos and got a product" — better than "I sent 3 photos and got nothing because one of them was 0 bytes."
- The workflow execution log still records the rehost step's accumulated success count for audit.

---

## Test coverage

`apps/backend/integration-tests/http/whatsapp-create-draft-product.spec.ts`:

| Test | What it asserts |
|------|-----------------|
| creates a DRAFT product from extracted fields with no media | status=draft, title/description/price match, metadata `created_via=whatsapp` + `wa_fabric_type` + `wa_colors`, single variant in store's default currency |
| defaults missing `suggested_price` to 0 | price.amount === 0 |
| fails the workflow when `extracted.title` is missing | `errors` populated with /title is required/, no product returned |
| fails the workflow when partner has no store | `errors` populated with /no store/, no product returned |

Run:

```bash
cd apps/backend
pnpm test:integration:http:shared ./integration-tests/http/whatsapp-create-draft-product.spec.ts
```

---

## Roadmap (where this workflow sits)

| PR | Status | Description |
|----|--------|-------------|
| W1 — media rehost helper | ✅ shipped (pre-existing) | `downloadAndSaveWhatsAppMedia` at `whatsapp-media-helper.ts:239` |
| **W2 — this workflow** | ✅ shipped | `createDraftProductFromExtractionWorkflow` |
| W3 — webhook emits `whatsapp.message_received` event | ✅ shipped 2026-05-31 | `whatsapp/route.ts` emits after parse + identity resolution; subscriber registers the name |
| W4 — `seed-partner-product-create-flow.ts` | ✅ shipped 2026-05-31 | Single shared flow; fires for any verified-WhatsApp partner. Seed via `run-backfill.sh seed-partner-product-create-flow`. Now uses `ai_extract_platform` (provider/model from admin-configured platforms, no hardcoded model id) |
| W5 — Confirm / Cancel interactive buttons | ✅ shipped 2026-06-01 | Flow reply switched from `mode: "text"` to `mode: "interactive"`; tap-Confirm flips DRAFT → PUBLISHED, tap-Cancel deletes. `handleProductCreateButtonReply` dispatches on `wa_pc_confirm:*` / `wa_pc_cancel:*` ids before the production-run parser. Edit deferred to W6. |
| W6 — Polish | ⏳ next | Edit button (free-text correction with conversation state), caption-only edges, photo-only edges, dedup verify, vision support on `ai_extract_platform` |

---

## W5 — Confirm / Cancel button taps

After the workflow returns a `prod_…`, the flow's `notify_partner` step now sends an `interactive` message with two reply buttons instead of a plain text. The button ids encode the action and the product id:

| Button | id (sent by Meta) | Server action |
|---|---|---|
| ✅ Confirm | `wa_pc_confirm:prod_…` | `productService.updateProducts({ id, status: "published" })` + reply with the admin link |
| 🗑️ Cancel | `wa_pc_cancel:prod_…` | `productService.deleteProducts([id])` + reply confirming removal |

When a tap arrives, the inbound webhook lands in `handleIncomingMessage` (`apps/backend/src/workflows/whatsapp/whatsapp-message-handler.ts`). Before the existing production-run lifecycle parser sees the message, a new prefix check routes anything starting with `wa_pc_` to `handleProductCreateButtonReply`. That handler resolves the product, validates state, and mutates.

### Idempotency rules

- Confirm tap on an **already-published** product → no-op, friendly "Already published" reply
- Cancel tap on an **already-published** product → refuses to delete (live storefront product); replies with the admin link instead. Partner can still unpublish from admin.
- Either tap with a missing/deleted product → "no longer available" reply

### Edit (deferred to W6)

Adding a third button (`Edit`) needs a small state machine: stash `pending_product_edit_id` on `messaging_conversation.metadata`, then route the next free-text from that partner into an "update title / price" handler rather than the standard intent dispatcher. Skipped for v1 — partners can resend a new photo + caption today, which creates a fresh draft. Worth the build once we see real usage volume.

### Meta classification

`mode: "interactive"` is **free-form** from Meta's perspective — same 24-hour window restriction as text and image. That's fine here because the flow fires immediately after the partner sent us a photo, which opens the window. The `send_whatsapp` operation's new `skip_if_outside_window` option would block the send if we ever tried to use interactive buttons unprompted — see [WhatsApp Send Modes & 24h Window](./whatsapp-send-modes-and-window-guard).

---

## Related

- [AI Extract Operation](./ai-extract-operation) — the original text-only operation; superseded by `ai_extract_platform` for new flows
- [AI Extract Platform Operation](./ai-extract-platform-operation) — provider / model resolved from admin-configured External Platforms; what W4's `extract_attrs` node uses today
- [WhatsApp Send Modes & 24h Window](./whatsapp-send-modes-and-window-guard) — when free-form messages deliver, when they get silently skipped
- [Partner WhatsApp — Production Run Flow](./whatsapp-partner-run-flow) — the outbound counterpart; same engine, opposite direction
- `apps/docs/notes/WHATSAPP_PRODUCT_CREATE.md` — the design doc with the full proposed message flow + tradeoff matrix between handler-only and visual-flow paths
- `apps/backend/src/workflows/whatsapp/whatsapp-media-helper.ts` — the rehost helper this workflow calls
- `apps/backend/src/api/partners/stores/[id]/products/quick/route.ts` — the HTTP equivalent for partners who use the web instead of WhatsApp; same `productInput` shape, no auto-DRAFT override
