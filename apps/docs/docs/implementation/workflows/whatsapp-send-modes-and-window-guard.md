---
title: "WhatsApp Send Modes & 24-hour Window Guard"
sidebar_label: "WhatsApp Send Modes / Window"
sidebar_position: 14
---

# WhatsApp Send Modes & 24-hour Window Guard

The `send_whatsapp` visual-flow operation supports four send modes. Three of them are **free-form** in Meta's terms and only deliver inside the recipient's 24-hour "service window". This page explains which mode delivers when, and how the `skip_if_outside_window` option closes the silent-failure gap that bit us on the partner-run flow.

**Source:** `apps/backend/src/modules/visual_flows/operations/send-whatsapp.ts`

---

## Meta's 24-hour conversation window

Whenever a recipient sends *any* WhatsApp message to a business number, a 24-hour "customer service window" opens for that recipient. During the window the business can reply with any free-form content. After 24 hours of recipient silence, Meta blocks free-form sends and only **utility / marketing / authentication templates** are allowed through.

Sending free-form outside the window doesn't queue or retry — Meta returns error code `131047` ("re-engagement required") and the message simply does not arrive.

| Send mode | Wire-level shape | Free-form? | Delivers outside 24h? |
|---|---|---|---|
| `template` | `type: "template"` with a Meta-approved `template_name` | No | ✅ Yes — templates are designed to initiate conversations |
| `text` | `type: "text"` | Yes | ❌ No |
| `image` | `type: "image"` with caption | Yes | ❌ No |
| `interactive` | `type: "interactive"` with reply buttons | Yes | ❌ No |

The W5 Confirm / Cancel buttons in the [Product Create flow](./whatsapp-create-draft-product) use `mode: "interactive"`. That's fine for W4 because the flow only fires when the partner just sent us a photo — we're inside the window by definition. Using `interactive` for an *unprompted* nudge (e.g. "tap to view your weekly summary") would fail silently outside the window — for that you'd need a Meta template with quick-reply buttons, which is a separate approval flow.

---

## The bug `skip_if_outside_window` fixes

`seed-partner-run-whatsapp-flow.ts` ships two follow-up messages after every production-run template:

1. `send_image` — design photo with a deep-link caption (image branch)
2. `send_link_text` — plain text with the deep-link (no-image fallback)

Both are free-form. The template above them always lands because utility templates are window-exempt. But for any partner who hadn't messaged us in the last 24h (most of them on a fresh assignment), the follow-up silently failed. Operators only saw:

- A clean template send in the messaging inbox
- A `messaging_message` row marked `failed` for the follow-up
- No partner-visible deep-link

Worse, it ate a Meta API call and wrote a noisy audit row every time.

---

## How the guard works

When the caller sets `skip_if_outside_window: true` on a free-form mode, the operation runs an extra check before any Meta call:

1. Query `messaging_conversation` rows for `(partner_id, phone_number)` (phone is the stable anchor; partner_id narrows when known)
2. Pick the most-recent matching conversation, then query its `messaging_message` rows with `direction: "inbound"`, ordered by `created_at DESC`, take 1
3. Compute `Date.now() - lastInbound.created_at`. If under 24h, proceed with the send. Otherwise, exit cleanly via the `failure` branch with:

```json
{
  "sent": false,
  "reason": "outside_24h_window",
  "last_inbound_at": "2026-05-15T08:12:00Z",
  "mode": "text",
  "_branch": "failure"
}
```

No Meta API call. No failed `messaging_message` row. The execution log still records the skip with its reason, so an operator querying for "why didn't this send" gets a clear answer.

`template` mode is unaffected — the guard short-circuits when `mode === "template"`.

---

## When to set the option

| Send pattern | `skip_if_outside_window` |
|---|---|
| Reply to an inbound message (W4 notify_partner, partner-handler text replies) | `false` (default) — you're inside the window by definition |
| Unprompted follow-up after a template (partner-run `send_link_text`, `send_image`) | **`true`** — most recipients are outside the window |
| Daily reminder text follow-up | **`true`** |
| Admin alert / test send | `false` — admin numbers don't need the guard |

The default is `false` so existing flows that knew they were inside the window keep working without edits.

---

## Operations currently using the guard (prod, 2026-06-01)

| Flow | Operation | Mode |
|---|---|---|
| Partner WhatsApp — Production Run (all events) | `send_image` | `image` |
| Partner WhatsApp — Production Run (all events) | `send_link_text` | `text` |

Both were patched in place via `PUT /admin/visual-flows/<id>` rather than re-seeded — the production-run flow has been tuned in the admin editor and a re-seed would have wiped those tweaks.

---

## Future improvements

- Cache the `last_inbound` lookup per `(partner_id, phone)` for a few seconds within an execution context — currently every guarded send fires its own DB query.
- Expose a `failure_reason: "outside_24h_window"` distinct branch handle so a flow can route to a template fallback automatically ("we couldn't reach you — tap to reopen the conversation").
- Optionally write a `messaging_message` row marked `skipped_outside_window: true` for traceability without the noise of `status: "failed"`.

---

## Related

- [Partner WhatsApp — Production Run Flow](./whatsapp-partner-run-flow) — the flow with the guarded follow-up steps
- [WhatsApp Product Create — Draft Workflow](./whatsapp-create-draft-product) — uses `mode: "interactive"` inside the window
- `apps/backend/src/modules/visual_flows/operations/send-whatsapp.ts` — the operation itself
