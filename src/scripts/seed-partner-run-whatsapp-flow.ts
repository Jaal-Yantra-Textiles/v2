/**
 * Seed: Partner WhatsApp — Production Run Notifications (single dispatcher)
 *
 * One active flow listens to all `production_run.*` events via wildcard
 * trigger (requires the subscriber upgrade in
 * src/subscribers/visual-flow-event-trigger.ts which accepts
 * `trigger_config.event_pattern`). The flow reads the run + partner,
 * maps the event to a Meta-approved template + variables, and sends via
 * the `send_whatsapp` operation.
 *
 * Templates mapped today (add more in the transform node as you approve
 * them in Meta):
 *   production_run.sent_to_partner → jyt_production_run_assigned
 *   production_run.cancelled       → jyt_production_run_cancelled
 *   production_run.completed       → jyt_production_run_completed (TODO approve)
 *
 * Other events still fire the flow but hit the "skip" branch — no send.
 *
 * The legacy subscriber (src/subscribers/whatsapp-partner-notifications.ts)
 * has been retired — this flow is the only path that sends partner-facing
 * production-run WhatsApps.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-partner-run-whatsapp-flow.ts
 *
 * Re-seed:
 *   Delete the existing flow first (admin UI or by id) and re-run. The
 *   script is idempotent and refuses to overwrite.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Partner WhatsApp — Production Run (all events)"

// ─── Canvas positions ────────────────────────────────────────────────────────
const X_CENTER = 500
const X_LEFT = 200
const X_RIGHT = 800

const Y_READ_RUN = 140
const Y_READ_PARTNER = 280
const Y_READ_DESIGN = 420
const Y_RESOLVE = 560
const Y_COND = 700
const Y_SEND = 840
const Y_GEN_LINK = 980
const Y_HAS_IMAGE = 1120
const Y_FOLLOWUP = 1260
const Y_SKIP = 840

// X for the no-image follow-up so it sits next to the image branch.
const X_LEFT_ALT = 350

// ─── Code for the resolve_template node ──────────────────────────────────────
//
// Returns the full send_whatsapp input payload so the downstream node can
// just interpolate from this one operation's output. Returns
// { skipped: true } when the event has no template — drives the condition.
const RESOLVE_TEMPLATE_CODE = `\
const eventName = $trigger?.event || ""
const expectedRunId = $trigger?.payload?.production_run_id || null
const expectedPartnerId = $trigger?.payload?.partner_id || null
const expectedDesignId = $trigger?.payload?.design_id || null

const run = $input.read_run?.records?.[0]
const partner = $input.read_partner?.records?.[0]
const design = $input.read_design?.records?.[0]

if (!expectedRunId) {
  return { skipped: true, reason: "missing_production_run_id_in_payload", event: eventName }
}
if (!expectedPartnerId) {
  // Parent / bundle run on a re-run dispatch — no partner attached. Skip.
  return { skipped: true, reason: "no_partner_on_event", event: eventName, run_id: expectedRunId }
}
if (!run || !partner) {
  return { skipped: true, reason: "missing_run_or_partner", event: eventName }
}
// Defensive: read_data drops null filter values silently and returns the
// first row when filters end up empty — verify identity so we never
// misdeliver to an unrelated partner.
if (run.id !== expectedRunId || partner.id !== expectedPartnerId) {
  return { skipped: true, reason: "id_mismatch", event: eventName, expectedRunId, expectedPartnerId, gotRunId: run?.id, gotPartnerId: partner?.id }
}

const partnerName = partner.name || "Partner"
const designName = design?.name || expectedDesignId || run?.design_id || "Unknown Design"
const quantity = String(run?.quantity ?? 0)
const runId = run?.id || expectedRunId

// Resolve ONE image to send as a follow-up. Try sources in priority
// order — thumbnail first (smallest, most likely present), then
// structured collections. Each source can be a plain URL string or an
// object with { url } / { image } / { src }.
function pickUrl(value) {
  if (!value) return null
  if (typeof value === "string") return value.trim() || null
  if (typeof value === "object") {
    return (
      (typeof value.url === "string" && value.url) ||
      (typeof value.image === "string" && value.image) ||
      (typeof value.src === "string" && value.src) ||
      null
    )
  }
  return null
}
function firstImageUrl(design) {
  if (!design) return null
  const direct = pickUrl(design.thumbnail_url)
  if (direct) return direct
  for (const key of ["moodboard", "media_files", "design_files"]) {
    const arr = design[key]
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      const url = pickUrl(item)
      if (url) return url
    }
  }
  return null
}
const designImageUrl = firstImageUrl(design)

// Resolve recipient phone — verified whatsapp_number first, then first
// active admin's phone. Mirrors the legacy subscriber priority.
let phone = null
if (partner.whatsapp_number && partner.whatsapp_verified) {
  phone = partner.whatsapp_number
} else {
  const admins = partner.admins || []
  const activeAdmin = admins.find(a => a && a.is_active && a.phone)
  phone = activeAdmin?.phone || null
}

if (!phone) {
  return { skipped: true, reason: "no_phone", event: eventName, partner_id: partner.id }
}

// Pick the partner's preferred WhatsApp language. Priority:
//   1. admin whose phone matches the resolved recipient phone
//   2. any active admin with a preferred_language set
//   3. any admin with a preferred_language set (inactive included)
// Falls back to null so send_whatsapp's own conv-metadata / phone-heuristic
// chain still has a chance. Phone match is digits-only suffix to tolerate
// "+91 …", "91…", and "0…" stylings.
function digitsOnly(v) {
  return (v || "").replace(/[^0-9]/g, "")
}
function phoneMatch(a, b) {
  const ad = digitsOnly(a), bd = digitsOnly(b)
  if (!ad || !bd) return false
  return ad === bd || ad.endsWith(bd) || bd.endsWith(ad)
}
const allAdmins = partner.admins || []
const matchedAdmin =
  allAdmins.find(a => a && a.preferred_language && phoneMatch(a.phone, phone))
const activeWithLang =
  allAdmins.find(a => a && a.is_active && a.preferred_language)
const anyWithLang =
  allAdmins.find(a => a && a.preferred_language)
const languageCode =
  matchedAdmin?.preferred_language ||
  activeWithLang?.preferred_language ||
  anyWithLang?.preferred_language ||
  null

// Extract cancellation / completion context from the event payload where available.
const notes = $trigger?.payload?.notes || run?.cancelled_reason || "No reason provided"
const producedQty = String($trigger?.payload?.produced_quantity ?? run?.produced_quantity ?? quantity)
const reason = $trigger?.payload?.reason || null

// Reminder-event aging — reminder events are fired by the scheduled
// reminder seed (src/scripts/seed-production-run-reminders-flow.ts) and
// carry a reminder_kind in the payload. We compute a human-friendly age
// label from run timestamps so the template body reads like "2 days ago".
function ageInDays(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.max(1, Math.floor(ms / 86400000))
}
const daysSinceAssignment = ageInDays(run?.created_at) ?? 1
const daysSinceAccepted = ageInDays(run?.accepted_at) ?? 1
const daysSinceStarted = ageInDays(run?.started_at) ?? 3

// Template map. Keep placeholder counts identical to the Meta template body.
// Canonical template names live in
// src/scripts/whatsapp-templates/partner-run-templates.ts and end in _v2 —
// they were re-approved in Meta with the button/ratio fixes. When you bump
// the spec to _v3, update these names to match after the new versions are
// APPROVED in all target WABAs.
const map = {
  "production_run.sent_to_partner": {
    template: "jyt_production_run_assigned_v3",
    vars: [partnerName, designName, quantity, runId],
  },
  "production_run.cancelled": {
    template: "jyt_production_run_cancelled_v3",
    vars: [partnerName, runId, designName, notes],
  },
  "production_run.completed": {
    template: "jyt_production_run_completed_v3",
    vars: [partnerName, runId, designName, producedQty],
  },
  // Reminders — fired daily by the scheduled reminder seed. Each event
  // carries a fresh per-day context_id so the 60-min dedup on
  // (context_type, context_id) does not swallow the next day's send.
  "production_run.reminder_assignment_pending": {
    template: "jyt_production_run_reminder_pending_v1",
    vars: [partnerName, designName, runId, String(daysSinceAssignment)],
  },
  "production_run.reminder_not_started": {
    template: "jyt_production_run_reminder_not_started_v1",
    vars: [partnerName, designName, runId, String(daysSinceAccepted)],
  },
  "production_run.reminder_idle": {
    template: "jyt_production_run_reminder_idle_v1",
    vars: [partnerName, designName, runId, producedQty, quantity],
  },
  // Add more mappings here as templates get approved in Meta.
  // "production_run.accepted":  { template: "…", vars: [...] },
  // "production_run.started":   { template: "…", vars: [...] },
  // "production_run.finished":  { template: "…", vars: [...] },
}

const config = map[eventName]
if (!config) {
  return { skipped: true, reason: "no_template_for_event", event: eventName }
}

// Per-day context_id for reminder events so the standard 60-min dedup on
// (context_type, context_id) does NOT swallow the next day's reminder.
// Format: "<runId>:reminder:<YYYY-MM-DD>". Same-day retries still dedup,
// which is the safe behaviour we want.
const isReminderEvent = eventName.indexOf("production_run.reminder_") === 0
let contextId = runId
if (isReminderEvent) {
  const d = new Date()
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  contextId = runId + ":reminder:" + yyyy + "-" + mm + "-" + dd
}

return {
  skipped: false,
  event: eventName,
  to: phone,
  partner_id: partner.id,
  template_name: config.template,
  variables: config.vars,
  // Emit the resolved language so the send op uses the partner's saved
  // preference (admin.preferred_language) rather than falling through to
  // the operation's conv-metadata / phone-heuristic default. Empty string
  // when no preference is on file → send_whatsapp's own chain takes over.
  language_code: languageCode || "",
  context_type: "production_run",
  // context_id drives send_whatsapp dedup. For reminder events it carries
  // the per-day suffix so consecutive days don't dedup each other.
  context_id: contextId,
  // run_id is always the raw run id — use this for deep links and any
  // user-facing display so the per-day suffix never leaks out.
  run_id: runId,
  design_image_url: designImageUrl,
  design_name: designName,
}
`

// ─── Flow definition ─────────────────────────────────────────────────────────

const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Single dispatcher for partner-facing WhatsApp notifications on every " +
    "production_run event. Uses event_pattern to listen to production_run.*, " +
    "maps the event to a Meta-approved template via an execute_code node, " +
    "then dispatches through the send_whatsapp operation (multi-number routing, " +
    "partner validation, dedup, audit persistence all included).",
  status: "draft" as const,
  trigger_type: "event" as const,
  trigger_config: {
    // Wildcard — requires src/subscribers/visual-flow-event-trigger.ts
    // with the event_pattern support. Falls back gracefully otherwise.
    event_pattern: "production_run.*",
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.7 },
    nodes: [
      { id: "trigger", type: "trigger", position: { x: X_CENTER, y: -20 }, data: { label: "Production Run — any event", triggerType: "event", triggerConfig: { event_pattern: "production_run.*" } } },
      { id: "read_run",         type: "operation", position: { x: X_CENTER,   y: Y_READ_RUN },     data: { label: "Read Production Run", operationKey: "read_run",         operationType: "read_data"    } },
      { id: "read_partner",     type: "operation", position: { x: X_CENTER,   y: Y_READ_PARTNER }, data: { label: "Read Partner",        operationKey: "read_partner",     operationType: "read_data"    } },
      { id: "read_design",      type: "operation", position: { x: X_CENTER,   y: Y_READ_DESIGN },  data: { label: "Read Design",         operationKey: "read_design",      operationType: "read_data"    } },
      { id: "resolve_template", type: "operation", position: { x: X_CENTER,   y: Y_RESOLVE },      data: { label: "Resolve Template",    operationKey: "resolve_template", operationType: "execute_code" } },
      { id: "has_template",     type: "operation", position: { x: X_CENTER,   y: Y_COND },         data: { label: "Has Template?",       operationKey: "has_template",     operationType: "condition"    } },
      { id: "send",             type: "operation", position: { x: X_LEFT,     y: Y_SEND },         data: { label: "Send WhatsApp",       operationKey: "send",             operationType: "send_whatsapp" } },
      { id: "gen_link",         type: "operation", position: { x: X_LEFT,     y: Y_GEN_LINK },     data: { label: "Generate Deep-Link",  operationKey: "gen_link",         operationType: "generate_partner_deeplink" } },
      { id: "has_image",        type: "operation", position: { x: X_LEFT,     y: Y_HAS_IMAGE },    data: { label: "Has Design Image?",   operationKey: "has_image",        operationType: "condition"    } },
      { id: "send_image",       type: "operation", position: { x: X_LEFT,     y: Y_FOLLOWUP },     data: { label: "Send Design Image",   operationKey: "send_image",       operationType: "send_whatsapp" } },
      { id: "send_link_text",   type: "operation", position: { x: X_LEFT_ALT, y: Y_FOLLOWUP },     data: { label: "Send Link (text)",    operationKey: "send_link_text",   operationType: "send_whatsapp" } },
      { id: "log_skip",         type: "operation", position: { x: X_RIGHT,    y: Y_SKIP },         data: { label: "Log: Skipped",        operationKey: "log_skip",         operationType: "log"          } },
    ],
    edges: [
      { id: "e-0",  source: "trigger",          sourceHandle: "default", target: "read_run",         targetHandle: "default" },
      { id: "e-1",  source: "read_run",         sourceHandle: "default", target: "read_partner",     targetHandle: "default" },
      { id: "e-2",  source: "read_partner",     sourceHandle: "default", target: "read_design",      targetHandle: "default" },
      { id: "e-3",  source: "read_design",      sourceHandle: "default", target: "resolve_template", targetHandle: "default" },
      { id: "e-4",  source: "resolve_template", sourceHandle: "default", target: "has_template",     targetHandle: "default" },
      { id: "e-5",  source: "has_template",     sourceHandle: "success", target: "send",             targetHandle: "default" },
      { id: "e-6",  source: "has_template",     sourceHandle: "failure", target: "log_skip",         targetHandle: "default" },
      { id: "e-7",  source: "send",             sourceHandle: "success", target: "gen_link",         targetHandle: "default" },
      { id: "e-8",  source: "gen_link",         sourceHandle: "default", target: "has_image",        targetHandle: "default" },
      { id: "e-9",  source: "has_image",        sourceHandle: "success", target: "send_image",       targetHandle: "default" },
      { id: "e-10", source: "has_image",        sourceHandle: "failure", target: "send_link_text",   targetHandle: "default" },
    ],
  },

  operations: [
    // ── 1. Read production run ────────────────────────────────────────────
    {
      operation_key: "read_run",
      operation_type: "read_data",
      name: "Read Production Run",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_READ_RUN,
      options: {
        entity: "production_runs",
        fields: [
          "id",
          "partner_id",
          "design_id",
          "quantity",
          "produced_quantity",
          "run_type",
          "status",
          "cancelled_reason",
        ],
        filters: { id: "{{ $trigger.payload.production_run_id }}" },
        limit: 1,
      },
    },

    // ── 2. Read partner ───────────────────────────────────────────────────
    {
      operation_key: "read_partner",
      operation_type: "read_data",
      name: "Read Partner",
      sort_order: 1,
      position_x: X_CENTER,
      position_y: Y_READ_PARTNER,
      options: {
        entity: "partner",
        fields: [
          "id",
          "name",
          "whatsapp_number",
          "whatsapp_verified",
          "admins.id",
          "admins.first_name",
          "admins.last_name",
          "admins.phone",
          "admins.is_active",
          "admins.preferred_language",
        ],
        filters: { id: "{{ $trigger.payload.partner_id }}" },
        limit: 1,
      },
    },

    // ── 3. Read design (no module link to production_runs — must read by id) ──
    {
      operation_key: "read_design",
      operation_type: "read_data",
      name: "Read Design",
      sort_order: 2,
      position_x: X_CENTER,
      position_y: Y_READ_DESIGN,
      options: {
        entity: "design",
        fields: [
          "id",
          "name",
          "thumbnail_url",
          "description",
          "design_type",
          "media_files",
          "moodboard",
          "design_files",
        ],
        filters: { id: "{{ $trigger.payload.design_id }}" },
        limit: 1,
      },
    },

    // ── 4. Resolve template config ─────────────────────────────────────────
    {
      operation_key: "resolve_template",
      operation_type: "execute_code",
      name: "Resolve Template",
      sort_order: 3,
      position_x: X_CENTER,
      position_y: Y_RESOLVE,
      options: {
        code: RESOLVE_TEMPLATE_CODE,
        timeout: 5000,
      },
    },

    // ── 5. Condition: was a template resolved? ────────────────────────────
    {
      operation_key: "has_template",
      operation_type: "condition",
      name: "Has Template?",
      sort_order: 4,
      position_x: X_CENTER,
      position_y: Y_COND,
      options: {
        condition_mode: "expression",
        // Skipped === true → failure branch (log only). false → success branch (send).
        expression: "resolve_template.skipped === false",
        filter_rule: { "resolve_template.skipped": { _eq: false } },
      },
    },

    // ── 6a. Send WhatsApp template (success branch) ────────────────────────
    {
      operation_key: "send",
      operation_type: "send_whatsapp",
      name: "Send WhatsApp",
      sort_order: 5,
      position_x: X_LEFT,
      position_y: Y_SEND,
      options: {
        // Full-variable syntax resolves to the actual value (not stringified)
        // when the entire option is a single {{ … }} expression.
        to: "{{ resolve_template.to }}",
        partner_id: "{{ resolve_template.partner_id }}",
        mode: "template",
        template_name: "{{ resolve_template.template_name }}",
        variables: "{{ resolve_template.variables }}",
        // Honor the partner's saved language preference. Empty string
        // (no preference on file) lets send_whatsapp's own resolver
        // chain (conv metadata → phone heuristic → env → "hi") take over.
        language_code: "{{ resolve_template.language_code }}",
        context_type: "{{ resolve_template.context_type }}",
        context_id: "{{ resolve_template.context_id }}",
        // Standard 60-minute dedup on (context_type, context_id) — blocks
        // double-send when an event retries.
        dedup_window_minutes: 60,
        // Production notifications should never leak to unknown recipients.
        require_partner: true,
      },
    },

    // ── 6c. Generate partner deep-link (success branch, after template) ───
    {
      operation_key: "gen_link",
      operation_type: "generate_partner_deeplink",
      name: "Generate Deep-Link",
      sort_order: 6,
      position_x: X_LEFT,
      position_y: Y_GEN_LINK,
      options: {
        partner_id: "{{ resolve_template.partner_id }}",
        run_id: "{{ resolve_template.run_id }}",
        type: "production_run",
        // base_url falls back to PARTNER_PORTAL_URL env then to the
        // hard-coded partner subdomain in the operation implementation.
      },
    },

    // ── 6d. Branch on whether resolve_template found a design image ────────
    // Without this branch, designs with no thumbnail/moodboard/media URL
    // never get the portal link (it lived only in send_image's caption).
    {
      operation_key: "has_image",
      operation_type: "condition",
      name: "Has Design Image?",
      sort_order: 7,
      position_x: X_LEFT,
      position_y: Y_HAS_IMAGE,
      options: {
        condition_mode: "expression",
        // Truthy non-empty design_image_url → success branch (image+caption).
        // Empty/null → failure branch (plain text with the link).
        expression: "!!resolve_template.design_image_url",
        filter_rule: { "resolve_template.design_image_url": { _ne: null } },
      },
    },

    // ── 6e. Send design image with deep-link caption (image branch) ───────
    {
      operation_key: "send_image",
      operation_type: "send_whatsapp",
      name: "Send Design Image",
      sort_order: 8,
      position_x: X_LEFT,
      position_y: Y_FOLLOWUP,
      options: {
        to: "{{ resolve_template.to }}",
        partner_id: "{{ resolve_template.partner_id }}",
        mode: "image",
        image_url: "{{ resolve_template.design_image_url }}",
        caption:
          "{{ resolve_template.design_name }} — Run {{ resolve_template.run_id }}\n" +
          "Open in portal (no password): {{ gen_link.url }}",
        context_type: "production_run",
        context_id: "{{ resolve_template.context_id }}",
        // Dedup off — the template send already dedups on the same
        // (context_type, context_id); this is a follow-up so we don't want
        // to swallow it as a duplicate.
        dedup_window_minutes: 0,
        require_partner: true,
      },
    },

    // ── 6f. Send the portal link as plain text (no-image branch) ──────────
    // The template send opened the 24-hour session window, so a follow-up
    // text delivers without needing another approved template.
    {
      operation_key: "send_link_text",
      operation_type: "send_whatsapp",
      name: "Send Link (text)",
      sort_order: 9,
      position_x: X_LEFT_ALT,
      position_y: Y_FOLLOWUP,
      options: {
        to: "{{ resolve_template.to }}",
        partner_id: "{{ resolve_template.partner_id }}",
        mode: "text",
        body:
          "{{ resolve_template.design_name }} — Run {{ resolve_template.run_id }}\n" +
          "Open in portal (no password): {{ gen_link.url }}",
        context_type: "production_run",
        context_id: "{{ resolve_template.context_id }}",
        dedup_window_minutes: 0,
        require_partner: true,
      },
    },

    // ── 6b. Log skip (failure branch) ──────────────────────────────────────
    {
      operation_key: "log_skip",
      operation_type: "log",
      name: "Log: Skipped",
      sort_order: 10,
      position_x: X_RIGHT,
      position_y: Y_SKIP,
      options: {
        message:
          "Skipping WhatsApp for event {{ $trigger.event }} — reason: {{ resolve_template.reason }}",
        level: "info",
      },
    },
  ],

  connections: [
    { source_id: "trigger",          source_handle: "default", target_id: "read_run",         connection_type: "default" as const },
    { source_id: "read_run",         source_handle: "default", target_id: "read_partner",     connection_type: "default" as const },
    { source_id: "read_partner",     source_handle: "default", target_id: "read_design",      connection_type: "default" as const },
    { source_id: "read_design",      source_handle: "default", target_id: "resolve_template", connection_type: "default" as const },
    { source_id: "resolve_template", source_handle: "default", target_id: "has_template",     connection_type: "default" as const },
    { source_id: "has_template",     source_handle: "success", target_id: "send",             connection_type: "success" as const },
    { source_id: "has_template",     source_handle: "failure", target_id: "log_skip",         connection_type: "failure" as const },
    { source_id: "send",             source_handle: "success", target_id: "gen_link",         connection_type: "success" as const },
    { source_id: "gen_link",         source_handle: "default", target_id: "has_image",        connection_type: "default" as const },
    { source_id: "has_image",        source_handle: "success", target_id: "send_image",       connection_type: "success" as const },
    { source_id: "has_image",        source_handle: "failure", target_id: "send_link_text",   connection_type: "failure" as const },
  ],
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export default async function seedPartnerRunWhatsAppFlow({
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
    },
    operations: FLOW_DEF.operations,
    connections: FLOW_DEF.connections,
  })

  console.log(`\nFlow created: ${flow.id}`)
  console.log(`  Open: /app/visual-flows/${flow.id}\n`)
  console.log(`Before activating:`)
  console.log(`  1. Ensure these 3 templates are APPROVED on every WABA you target:`)
  console.log(`     - jyt_production_run_assigned_v3  (with buttons)`)
  console.log(`     - jyt_production_run_cancelled_v3`)
  console.log(`     - jyt_production_run_completed_v3`)
  console.log(`     Check status via the admin Templates panel or:`)
  console.log(`       MODE=dry-run npx medusa exec ./src/scripts/manage-whatsapp-templates.ts`)
  console.log(`  2. Flip flow status: draft → active in the admin editor.`)
}
