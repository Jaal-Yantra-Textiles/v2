/**
 * Seed: Partner WhatsApp — Product Create (W4)
 *
 * One shared flow listens to every `whatsapp.message_received` event from
 * the inbound webhook (emitted in W3 — see route.ts) and creates a DRAFT
 * product on the partner's storefront when the message looks like a
 * product submission (photo + caption from a verified partner).
 *
 * The flow:
 *   trigger (whatsapp.message_received)
 *     → eligible? (partner_id resolved AND type=image AND caption present)
 *         success → extract caption (ai_extract: title / price / fabric / colors)
 *                 → create draft (W2 workflow: createDraftProductFromExtractionWorkflow)
 *                 → notify partner (text reply with admin link)
 *         failure → log skip (the event still fires for non-image / non-partner senders)
 *
 * Why this design
 *   - Single shared flow (not per-partner) because the extraction prompt is
 *     the same across partners and `partner_id` is resolved upstream by
 *     `resolvePartnerByPhone` (W3) which only returns verified partners. Any
 *     verified partner gets the feature; no per-partner seeding required.
 *   - Caption-only extraction for v1. The visual-flow `ai_extract` operation
 *     is text-only today. Image still becomes the product photo via W2 — it
 *     just doesn't drive attribute inference yet. Vision support is a
 *     follow-up.
 *   - Status defaults to "draft" — operator flips to "active" in admin after
 *     a graph review. This matches `seed-partner-payment-status-flow.ts`.
 *   - No Confirm/Edit/Cancel interactive yet (W5). v1 just creates the draft
 *     and tells the partner where to publish it.
 *
 * Run locally:
 *   npx medusa exec ./src/scripts/seed-partner-product-create-flow.ts
 *
 * Run on AWS Fargate:
 *   ./deploy/aws/scripts/run-backfill.sh seed-partner-product-create-flow
 *
 * Re-seed:
 *   Delete the existing flow (admin UI or by id) and re-run. The script is
 *   idempotent — it refuses to overwrite an existing flow with the same name.
 *
 * Before activating in admin:
 *   1. Verify a partner you trust has a verified WhatsApp number.
 *   2. Flip status: draft → active in the admin editor.
 *   3. Test: partner sends photo + "Test product ₹100" to the JYT WhatsApp
 *      number. Within seconds, a DRAFT product should appear under their
 *      store and they should receive a text reply with the admin URL.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Partner WhatsApp — Product Create"

// ─── Canvas positions ────────────────────────────────────────────────────────
const X_CENTER = 500
const X_LEFT = 200
const X_RIGHT = 800

const Y_TRIGGER = -20
const Y_ELIGIBLE = 140
const Y_EXTRACT = 320
const Y_CREATE = 500
const Y_NOTIFY = 680
const Y_SKIP = 320

// ─── Flow definition ─────────────────────────────────────────────────────────

const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Auto-create DRAFT products from partner WhatsApp messages. Fires on " +
    "whatsapp.message_received when sender is a verified partner and the " +
    "message is a photo with a caption. Extracts title / price / fabric / " +
    "colors from caption text, calls createDraftProductFromExtractionWorkflow " +
    "to persist the product + rehost the image, then replies with the " +
    "admin URL. Confirm/Edit/Cancel buttons land in a follow-up flow (W5).",
  status: "draft" as const,
  trigger_type: "event" as const,
  trigger_config: {
    event_pattern: "whatsapp.message_received",
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.8 },
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        position: { x: X_CENTER, y: Y_TRIGGER },
        data: {
          label: "WhatsApp Message Received",
          triggerType: "event",
          triggerConfig: { event_pattern: "whatsapp.message_received" },
        },
      },
      {
        id: "eligible",
        type: "operation",
        position: { x: X_CENTER, y: Y_ELIGIBLE },
        data: { label: "Eligible? (verified partner + image|document + caption)", operationKey: "eligible", operationType: "condition" },
      },
      {
        id: "extract_attrs",
        type: "operation",
        position: { x: X_LEFT, y: Y_EXTRACT },
        data: { label: "Extract Attributes from Caption", operationKey: "extract_attrs", operationType: "ai_extract_platform" },
      },
      {
        id: "create_draft",
        type: "operation",
        position: { x: X_LEFT, y: Y_CREATE },
        data: { label: "Create DRAFT Product (W2)", operationKey: "create_draft", operationType: "trigger_workflow" },
      },
      {
        id: "notify_partner",
        type: "operation",
        position: { x: X_LEFT, y: Y_NOTIFY },
        data: { label: "Notify Partner (text)", operationKey: "notify_partner", operationType: "send_whatsapp" },
      },
      {
        id: "log_skip",
        type: "operation",
        position: { x: X_RIGHT, y: Y_SKIP },
        data: { label: "Log: Not Eligible", operationKey: "log_skip", operationType: "log" },
      },
    ],
    edges: [
      { id: "e-0", source: "trigger",       sourceHandle: "default", target: "eligible",       targetHandle: "default" },
      { id: "e-1", source: "eligible",      sourceHandle: "success", target: "extract_attrs",  targetHandle: "default" },
      { id: "e-2", source: "extract_attrs", sourceHandle: "default", target: "create_draft",   targetHandle: "default" },
      { id: "e-3", source: "create_draft",  sourceHandle: "default", target: "notify_partner", targetHandle: "default" },
      { id: "e-4", source: "eligible",      sourceHandle: "failure", target: "log_skip",       targetHandle: "default" },
    ],
  },

  operations: [
    // ── 1. Eligibility check ──────────────────────────────────────────────
    // All three must hold:
    //   partner_id is set        → sender resolved to a verified partner
    //   type in (image, document) → photo, OR a doc the partner used the
    //                               file-picker for. WhatsApp clients send
    //                               iPhone-shot photos as "document" when
    //                               the user picks them via Files instead of
    //                               Photos — same product intent, just the
    //                               picker preserves original quality.
    //   caption non-empty        → partner described the product
    // Everything else (admin DMs, text messages, status updates, unverified
    // numbers, photos without captions) falls through to log_skip.
    {
      operation_key: "eligible",
      operation_type: "condition",
      name: "Eligible? (verified partner + image|document + caption)",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_ELIGIBLE,
      options: {
        condition_mode: "expression",
        expression:
          "$trigger.partner_id != null && ($trigger.type === 'image' || $trigger.type === 'document') && ($trigger.caption || '').length > 0",
        filter_rule: {
          _and: [
            { "$trigger.partner_id": { _null: false } },
            { "$trigger.type": { _in: ["image", "document"] } },
            { "$trigger.caption": { _empty: false } },
          ],
        },
      },
    },

    // ── 2. Extract attributes from caption text ───────────────────────────
    // Caption-only for v1. Output keys map 1:1 to W2's `extracted` input.
    // Title is required — if the model can't infer one, W2 throws and the
    // flow logs the failure with the partner's caption attached.
    //
    // Uses `ai_extract_platform` so provider / api_key / model are read from
    // the admin-configured External Platform (Settings → External Platforms,
    // category=ai, metadata.role=ai_search_chat). Rotating to a different
    // provider or model is a UI action — no flow edit, no redeploy.
    {
      operation_key: "extract_attrs",
      operation_type: "ai_extract_platform",
      name: "Extract Attributes from Caption",
      sort_order: 1,
      position_x: X_LEFT,
      position_y: Y_EXTRACT,
      options: {
        role: "ai_search_chat",
        input: "{{ $trigger.caption }}",
        system_prompt:
          "Extract product attributes from this textile product caption from a partner artisan. " +
          "Return ONLY a JSON object — no markdown, no code blocks.\n\n" +
          "The caption may be terse (e.g. 'Saree silk ₹4500', 'Cotton kurta red XL 1200'). " +
          "Infer a clean product title (proper case, no price). " +
          "Extract suggested_price as a plain number (₹ / Rs / INR / $ are all prices — strip the symbol). " +
          "Infer fabric_type from words like 'silk', 'cotton', 'linen', 'khadi', 'wool'. " +
          "Infer colors as an array — only colors the partner actually wrote. Empty array if none.\n\n" +
          "Omit any field you can't confidently extract.",
        schema_fields: [
          { name: "title",          type: "string", description: "Clean product title (proper case, no price, no fabric noise)", required: true },
          { name: "suggested_price", type: "number", description: "Numeric price in partner's currency (strip ₹/Rs/$)", required: false },
          { name: "fabric_type",    type: "string", description: "Fabric (silk, cotton, linen, khadi, wool, …) — omit if not mentioned", required: false },
          { name: "colors",         type: "array",  description: "Array of color names the partner wrote. Empty if none.", required: false },
        ],
        fallback_on_error: false,
      },
    },

    // ── 3. Create the DRAFT product (W2 workflow) ─────────────────────────
    // Reuses createDraftProductFromExtractionWorkflow shipped in PR #292.
    // The workflow rehosts the WhatsApp media (Meta presigned URL → S3) and
    // creates the product on the partner's store with status=DRAFT.
    {
      operation_key: "create_draft",
      operation_type: "trigger_workflow",
      name: "Create DRAFT Product (W2)",
      sort_order: 2,
      position_x: X_LEFT,
      position_y: Y_CREATE,
      options: {
        workflow_name: "create-draft-product-from-extraction",
        wait_for_completion: true,
        input: {
          partner_id:   "{{ $trigger.partner_id }}",
          partner_name: "{{ $trigger.partner_name }}",
          media_ids:    "{{ $trigger.media_ids }}",
          caption:      "{{ $trigger.caption }}",
          extracted: {
            title:           "{{ extract_attrs.title }}",
            suggested_price: "{{ extract_attrs.suggested_price }}",
            fabric_type:     "{{ extract_attrs.fabric_type }}",
            colors:          "{{ extract_attrs.colors }}",
          },
        },
      },
    },

    // ── 4. Notify partner with admin URL ──────────────────────────────────
    // Text mode is OK here: the partner just messaged us, so we're inside
    // Meta's 24-hour window. Dedup on (whatsapp_product_create, message_id)
    // blocks accidental double-sends from event retries.
    {
      operation_key: "notify_partner",
      operation_type: "send_whatsapp",
      name: "Notify Partner",
      sort_order: 3,
      position_x: X_LEFT,
      position_y: Y_NOTIFY,
      options: {
        to:         "{{ $trigger.from }}",
        partner_id: "{{ $trigger.partner_id }}",
        // W5 — interactive Confirm / Cancel buttons. The partner just
        // sent us a photo so we're inside Meta's 24-hour window; no
        // skip_if_outside_window needed. Button taps return on the
        // inbound webhook with buttonReplyId = "wa_pc_confirm:<id>" or
        // "wa_pc_cancel:<id>", which whatsapp-message-handler dispatches
        // to handleProductCreateButtonReply.
        mode:       "interactive",
        interactive_body:
          "✅ Draft product created: *{{ create_draft.result.product_title }}*\n" +
          "Open in your portal: {{ create_draft.result.admin_url }}\n\n" +
          "Tap *Confirm* to publish, or *Cancel* to remove the draft.",
        interactive_buttons: [
          { id: "wa_pc_confirm:{{ create_draft.result.product_id }}", title: "✅ Confirm" },
          { id: "wa_pc_cancel:{{ create_draft.result.product_id }}",  title: "🗑️ Cancel" },
        ],
        context_type: "whatsapp_product_create",
        context_id:   "{{ $trigger.message_id }}",
        dedup_window_minutes: 60,
        require_partner: true,
      },
    },

    // ── 5. Log skip (failure branch) ──────────────────────────────────────
    // Most inbound traffic lands here — text messages, status webhooks,
    // photos without captions, unverified senders. Logging is enough; we
    // don't reply because spamming every text would be hostile to the
    // existing partner-run dispatcher.
    {
      operation_key: "log_skip",
      operation_type: "log",
      name: "Log: Not Eligible",
      sort_order: 4,
      position_x: X_RIGHT,
      position_y: Y_SKIP,
      options: {
        message:
          "Skipping product-create for from={{ $trigger.from }} type={{ $trigger.type }} " +
          "partner_id={{ $trigger.partner_id }} caption_len={{ $trigger.caption.length }}",
        level: "info",
      },
    },
  ],

  connections: [
    { source_id: "trigger",       source_handle: "default", target_id: "eligible",       connection_type: "default" as const },
    { source_id: "eligible",      source_handle: "success", target_id: "extract_attrs",  connection_type: "success" as const },
    { source_id: "extract_attrs", source_handle: "default", target_id: "create_draft",   connection_type: "default" as const },
    { source_id: "create_draft",  source_handle: "default", target_id: "notify_partner", connection_type: "default" as const },
    { source_id: "eligible",      source_handle: "failure", target_id: "log_skip",       connection_type: "failure" as const },
  ],
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export default async function seedPartnerProductCreateFlow({
  container,
}: {
  container: any
}) {
  const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)

  const [existing] = await service.listVisualFlows({ name: FLOW_NAME } as any)
  if (existing) {
    console.log(`Flow "${FLOW_NAME}" already exists (${existing.id}) — skipping.`)
    console.log(`Delete it in the admin UI (or by id) to re-seed.`)
    return
  }

  console.log(`Creating flow "${FLOW_NAME}"...`)

  const flow = await service.createCompleteFlow({
    flow: {
      name: FLOW_DEF.name,
      description: FLOW_DEF.description,
      status: FLOW_DEF.status,
      trigger_type: FLOW_DEF.trigger_type,
      trigger_config: FLOW_DEF.trigger_config,
      canvas_state: FLOW_DEF.canvas_state,
    },
    operations: FLOW_DEF.operations,
    connections: FLOW_DEF.connections,
  })

  console.log(`\nFlow created: ${flow.id}`)
  console.log(`  Open: /app/visual-flows/${flow.id}\n`)
  console.log(`Before activating:`)
  console.log(`  1. Verify a partner you trust has a verified WhatsApp number.`)
  console.log(`  2. Flip flow status: draft → active in the admin editor.`)
  console.log(`  3. Test: have the partner send a photo + caption (e.g.`)
  console.log(`     "Saree silk ₹4500") to the JYT WhatsApp number.`)
  console.log(`     A DRAFT product should appear in their store + they get`)
  console.log(`     a text reply with the admin URL.`)
}
