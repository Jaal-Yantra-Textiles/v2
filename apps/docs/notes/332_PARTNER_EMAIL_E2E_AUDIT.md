# #332 — Partner email services end-to-end audit

_Audit by daemon chunk on 2026-06-21. Covers every email/notification touchpoint,
with focus on partner-facing mail. Live inbox delivery is human-gated; everything
verifiable from code + the prod admin API is captured here._

## TL;DR

- **Provider wiring is correct in prod.** `medusa-config.prod.ts` registers Resend
  (`email`), Mailjet (`email_bulk`), Maileroo (`email_partner`), local (`feed`),
  whatsapp-audit (`whatsapp`). Partner mail routes through **Maileroo / `email_partner`**.
- **All partner DB templates exist and are ACTIVE in prod** (verified via
  `GET /admin/email-templates` on v3.jaalyantra.com): `partner-order-placed`,
  `partner-order-fulfilled`, `partner-order-cancelled`, `partner-admin-added`,
  `partner-created-from-admin`, `partner-verified`, `password-reset`,
  **and `partner-task-assigned`**.
- **One concrete code gap fixed this chunk:** `partner-task-assigned` template was
  active in prod but `src/subscribers/task-assigned.ts` was an **empty stub** → the
  email never fired. Now wired (see PR).
- **Remaining gaps are product-decision-gated** (region-request partner email,
  production-run partner email, customer cancellation email). Documented below.
- **Live send / inbox delivery cannot be verified headless** → human checklist at bottom.

## Architecture (how a partner email is sent)

1. Subscriber catches a domain event → runs an email workflow.
2. Workflow resolves the partner + active admins, fetches the **DB email template**
   via `EmailTemplatesService.getTemplateByKey(key)` (throws `NOT_FOUND` if the row
   is missing or `is_active=false`), compiles `html_content`/`subject` with Handlebars.
3. Calls `notificationModuleService.createNotifications({ to, channel, template, data })`
   with `_template_html_content` / `_template_subject` / `_template_from` /
   `_template_processed:true` attached.
4. The channel's provider sends. Partner channel = `email_partner` → **Maileroo**.
   If `_template_processed` is absent, Resend falls back to a generic React template
   (`src/modules/resend/templates/default-email.tsx`) — partner path always processes.

Key files:
- Providers: `medusa-config.prod.ts` (lines ~169-216), `medusa-config.dev.ts`. Base
  `medusa-config.ts` (loaded by `medusa develop`) only has `local` + `whatsapp-audit`.
- Generic email workflow: `src/workflows/email/workflows/send-notification-email.ts`
  (hardcodes `channel:"email"` → Resend; NOT used for partner channel).
- Partner order email: `src/workflows/email/workflows/send-partner-order-email.ts`
  + step `src/workflows/email/steps/resolve-partner-from-order.ts`.
- Template store: `src/modules/email_templates/` (`getTemplateByKey`).

## Register — every send site

| Event | File | Channel→Provider | Template | Recipient | Notes |
|---|---|---|---|---|---|
| order.placed | subscribers/order-placed.ts | email→Resend | order-placed | customer | always |
| order.placed | subscribers/order-placed.ts → send-partner-order-email | email_partner→Maileroo | partner-order-placed | partner admins | best-effort, skips if no partner |
| order.fulfillment_created | subscribers/order-fullfilled.ts | email→Resend | order-fulfillment-procured | customer | skip if no_notification |
| order.fulfillment_created | subscribers/order-fullfilled.ts | email_partner→Maileroo | partner-order-fulfilled | partner admins | best-effort |
| order.canceled | subscribers/order-canceled.ts | email_partner→Maileroo | partner-order-cancelled | partner admins | best-effort; **no customer cancel email** |
| design.assigned | subscribers/design-assigned.ts | email→Resend | design-assigned | customer | |
| auth.password_reset | subscribers/password-reset.ts | email→Resend | password-reset | user (customer/partner/admin via urlPrefix) | |
| partner.created.fromAdmin | subscribers/partner-created-from-admin.ts | email→Resend | partner-created-from-admin | partner admin | |
| partner.admin.added | subscribers/partner-admin-added.ts | email→Resend | partner-created-from-admin | new admin | |
| **task_assigned** | **subscribers/task-assigned.ts** | **email_partner→Maileroo** | **partner-task-assigned** | **partner admins** | **FIXED this chunk (was empty stub)** |
| production_run.{accepted,started,finished,completed,cancelled} | subscribers/production-run-notifications.ts | feed→local | admin-ui | admin (in-app only) | **no partner email** |
| visual_flow_execution.{started,failed,cancelled} | subscribers/visual-flow-lifecycle-email.ts | email→Resend | visual-flow-{started,failure} | admin (metadata/env) | throttled 10min |
| POST /store/contact-region-request | api/store/contact-region-request/route.ts | feed→local | admin-ui | admin (in-app only) | **no partner/admin email** |
| agreement send | workflows/agreements/send-agreement-email.ts | email→Resend | agreement-email | signer | |

## Gaps & findings

### FIXED — task_assigned email never fired (code gap)
`runTaskAssignmentWorkflow` (workflows/tasks/run-task-assignment.ts) emits
`task_assigned` with `{ task_id, partner_id }`, the `partner-task-assigned` template
is active in prod, but `subscribers/task-assigned.ts` had an empty body. Wired to
`sendPartnerTaskAssignedWorkflow` (new) → resolves partner+admins+task, compiles the
DB template, sends via `email_partner`. Pure helper `partner-task-email.ts` unit-tested.

### DECISION-GATED — not built (need product call)
1. **Region-request → partner/admin email.** `/store/contact-region-request` only
   creates a `feed` notification (kind=region_request). The roadmap line mentions FX
   added a region-request notification; today it's in-app only. _Decision: should a
   region request email the platform admin and/or the owning partner? Which template?_
2. **Production-run lifecycle → partner email.** Status changes (accepted/started/
   finished/completed/cancelled) only hit the admin feed. Partners learn indirectly via
   the fulfillment email. _Decision: do partners want mid-lifecycle emails, and at which
   transitions?_
3. **Order cancellation → customer email.** `order.canceled` notifies the partner but
   not the customer. _Decision: should customers get a cancellation email (template
   `order-canceled` exists & active)?_

### Robustness note (left as-is, by design)
In `send-partner-order-email.ts` the `getTemplateByKey` call is **outside** the
per-admin try/catch, so a missing/inactive partner template row throws and fails the
whole partner email. Kept loud intentionally — a missing template is exactly the kind
of misconfig #332 wants surfaced, not silently swallowed. (The new task-assigned step
treats a missing template as best-effort skip + warn, since it's lower-criticality.)

### Config note
`medusa develop` loads base `medusa-config.ts`, which does NOT register Resend/Mailjet/
Maileroo — so **local dev cannot actually send** partner/customer email (channel
`email` falls to `local` provider; `email_partner`/`email_bulk` have no provider →
`createNotifications` errors, swallowed by best-effort try/catch). Prod is unaffected
(Dockerfile cp-overwrites with `medusa-config.prod.ts`). Integration tests that boot
the base config therefore cannot assert a real partner send — verify pure logic via
unit tests + rely on the human inbox checklist for delivery.

## Human verification checklist (the live tail — cannot run headless)

1. Place a real order on a GOF/partner storefront → confirm the partner admin inbox
   receives `partner-order-placed` (from `partner+<handle>@partner.jaalyantra.com`).
2. Fulfill that order → confirm `partner-order-fulfilled` (tracking fields populated).
3. Cancel an order → confirm `partner-order-cancelled`.
4. Assign an eventable task to a partner → confirm `partner-task-assigned` (NEW).
5. Create a partner from admin → confirm `partner-created-from-admin` (temp password).
6. Trigger password reset as a partner → confirm `password-reset` with the partner URL.
7. Confirm Maileroo dashboard shows the sends (deliverability, SPF/DKIM for
   `partner.jaalyantra.com`).
8. Decide on the 3 decision-gated gaps above; file follow-ups if wanted.

## Prod template inventory (42 active, captured 2026-06-21)
Partner-relevant active keys present: partner-order-placed, partner-order-fulfilled,
partner-order-cancelled, partner-admin-added, partner-created-from-admin,
partner-task-assigned, partner-verified, password-reset, design-assigned,
order-placed, order-canceled, order-fulfillment-procured/created, delivery-created,
visual-flow-started, visual-flow-failure. (Full list via
`GET /admin/email-templates?limit=100`.)
