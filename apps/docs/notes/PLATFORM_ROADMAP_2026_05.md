# Platform Roadmap — Open Backlog (captured 2026-05-26)

> **GitHub task list (added 2026-06-06):** the open items below are now
> mirrored as GitHub issues for day-to-day tracking. Umbrella tracker:
> [#352 — Platform Backlog](https://github.com/Jaal-Yantra-Textiles/v2/issues/352).
> Pull the whole set down with `gh issue list --label roadmap --limit 50`.
> Issue titles carry the `[#N]` roadmap number so the two stay in sync;
> this doc remains the narrative source-of-truth (the *why* + the
> closed-out history), GitHub holds the actionable checklist.

> Working order for the next stretch of platform work. Top section is
> the region-sharing gap discovered while debugging GOF's storefront
> serving AU customers. Lower section is the open backlog to walk
> through one at a time starting 2026-05-27.
>
> Each item: **what**, **why**, **first step**, rough **effort**. Items
> get promoted to PRs as we pick them up.

---

## 0. Admin → partner region propagation (active, blocks live AU/EU/US/ID traffic)

**Discovery:** GOF storefront shows "We don't ship to AU yet" for AU
visitors. Investigation: AU region exists in admin globally; storefront
fetches it via `/store/regions`; but **GOF's variants only have INR
prices** because `store.supported_currencies = [inr]`. The FX fanout
(PRs G3-G5) fans out only to currencies in supported_currencies, so
nothing beyond INR ever materializes. Every partner store on the
platform is in the same shape — `inr`-only — except Woven Futures
(`aud`-only) and Parmar Mukesh Bhai (`inr,usd`).

**Root cause:** no `region.created` subscriber, no admin-side action
that pushes a region down to existing partners. `partner_region` link
rows are created only when (a) a partner creates a region themselves
or (b) the one-shot `backfill-partner-region-links.ts` runs (which
only links each partner's `default_region_id`).

### 0A — Unblock affected partners (one-off, ~30 min)

Scripts + runbook landed 2026-06-01 (branch
`feat/backfill-all-regions-to-partners`). Operator runbook lives at
`PLATFORM_0A_RUNBOOK.md`. The three passes:

1. `backfill-all-admin-regions-to-partners.ts` — cross-products every
   partner with every admin region into `partner_region`.
2. `backfill-store-currencies-from-partner-regions.ts` (existing) —
   extends `store.supported_currencies` for every linked region.
3. `fanout-existing-variant-prices.ts` — replays the FX fanout
   workflow against existing variant prices so AUD/EUR/USD/IDR rows
   materialize from the INR base.

All three are idempotent + dry-run aware. `deploy/aws/scripts/run-backfill.sh`
threads `REGION_IDS`/`PARTNER_IDS`/`CONCURRENCY` through to the
Fargate one-off task. Recommended canary: one partner via
`PARTNER_IDS=par_x`, verify, then full sweep.

**Acceptance:** GOF + 6+ other live partner storefronts stop showing
the "we don't ship here" fallback for AU/EU/US/ID visitors. **Closed
out 2026-06-02** — 94 links created, 11 stores' currencies extended,
200 auto-prices materialized; canary verified against Sharlho + Ielo
(USD/EUR/AUD price resolution).

### 0B — Subscriber on `region.created` / `region.updated` (~half day)

**Status: SHIPPED 2026-06-03.** Branch `feat/0b-region-propagate-subscriber`.

Components landed:
- `src/workflows/regions/propagate-region-to-partners.ts` — single
  source of truth for the propagation logic. Takes `region_id` +
  `{ trigger_fanout?, partner_ids? }`, returns counts.
- `src/subscribers/region-propagate.ts` — handles `region.created` and
  `region.updated`. Fanout gated behind `REGION_PROPAGATE_FANOUT=1`
  (default off; partners' next variant save fans out via the existing
  batch-route hook).
- `GET /admin/regions/:id/partner-coverage` — counts + unlinked
  partners list.
- `POST /admin/regions/:id/share-to-all` — manual re-run with optional
  `trigger_fanout` + `partner_ids` scoping.
- Admin widget on `region.details.side.after` — shows "Linked to
  N/M partners" + "Share to all" button with FX-fanout opt-in
  checkbox.
- 4 integration tests (`integration-tests/http/partner-regions/region-propagate-subscriber.spec.ts`) all green.

Subscriber listens for region create/update on admin side, then for
every active partner:
- Upserts `partner_region` link
- Adds the region's `currency_code` to `store.supported_currencies` if
  missing (reuse the existing `auto-expand` helper)
- Optionally kicks off FX fanout for existing variants on that store

Also: small admin-side affordance — when admin opens a region in admin
UI, show "linked to N partners" + a "share to all" button as a manual
trigger when partners need it ad-hoc.

**Acceptance:** admin creates a new region → every partner store
inherits the currency within minutes → next visitor from that country
sees prices, not the fallback.

---

## Open backlog — work through one at a time

Grouped by theme so we can batch context. Numbers reference the
captured list; ordering inside this doc is just for readability.

### Bugs + immediate UX polish

#### 1. Category dropdown in "Add Raw Material" UI

**Status: FIXED 2026-06-07 (Playwright-verified).** Root cause: the
category field is the custom `CategorySearch` component, not a Medusa
combobox. Its results dropdown was an `absolute`-positioned `<div>`
inside the scrollable `RouteFocusModal` body, so it was clipped by the
overflow ancestor. **A deeper bug surfaced while fixing it:** existing
categories never loaded at all — the form fetched
`/admin/categories/rawmaterials` with `{name:""}` (and `{name:q}` while
typing), but that endpoint's `name` filter returns nothing for
empty/partial values, and the hook's query key is static so it never
refetched. The picker only ever worked for *creating* new categories.

Final fix (chose the proper component over a portal band-aid, per
"mirror Medusa, don't invent"): ported Medusa's ariakit `Combobox`
(`components/inputs/combobox/combobox.tsx` + a `generic-forward-ref`
util) from partner-ui into the admin, and rewrote `CategorySearch` to
use it. The ariakit popover is portaled and flips/repositions on
overflow (no clipping), and its `onCreateOption` preserves the
type-to-create-new-category behaviour. Both call sites
(`raw-material-form.tsx`, `edit-raw-material.tsx`) now fetch **all**
categories once (`{limit:100}`, no broken `name` filter) and let the
combobox filter client-side via `matchSorter`. Placeholder also got a
default so the raw `common.searchOrCreateCategory` i18n key stops
showing. Verified in the running admin via Playwright: existing
categories load + filter (`cotton`/`Cotton`), dropdown renders
unclipped over the modal, select-existing and create-new both work.

**Server-side follow-up (2026-06-07):** also fixed the underlying
endpoint so partial search works for any consumer, not just the
client-side workaround. `GET /admin/categories/rawmaterials` now accepts
`q` (canonical) and `name` search params and an `offset`; the list
workflow normalizes the term to an ilike `$or` across name + description
(mirroring the designs list workflow) instead of the broken exact-match
`name` filter. The admin hook's React Query key now includes the params
(it was static, so search terms never refetched). Test:
`integration-tests/http/raw-material-categories-search.spec.ts` (partial
+ case-insensitive match, non-match → empty), green; live-verified
`?q=cot`/`?name=cot` → 2, `?q=goog` → 1, no-param → all.

The dropdown doesn't render cleanly — likely a portal / overflow /
z-index issue (same family as the FX badge bug from this morning).
**First step:** reproduce in admin, screenshot the broken state, grep
for the raw-materials form component, check whether it's using
Combobox vs a custom select.
**Effort:** 1-2 hours.

#### 2. Replace inline editing with Medusa standards across admin

**Status: IN PROGRESS (GitHub #330).** Inventory of 8 inline-edit
offenders captured on the issue, ranked worst-first. Routes ported so
far (2026-06-07, all Playwright-verified in the running admin):

1. Admin **Material Usage** "Log" form
   (`design-consumption-logs-section.tsx`) — moved from an in-card
   inline panel to a Medusa side `Drawer`; when the design has no linked
   inventory it shows a "No inventory linked yet" empty state with just a
   Close button (no dead form).
2. Admin **Partner → General** section
   (`partner-general-section.tsx`) — was an always-editable inline form
   with a dirty-gated Save. Now a read-only key/value display
   (Name/Handle/Workspace Type/Logo URL + status & Verified badges) with
   an **Edit** action in the section menu that opens a `Drawer` with the
   form. Header badges read the persisted `partner` values so the read
   view only reflects saved state.
3. partner-ui **design consumption-logs** twin → Drawer (same empty
   state as the admin one).
4. partner-ui **production-run-detail** `CompleteRunInlineForm` → Drawer.
5. partner-ui **order fulfillment** pickup-scheduling form → Drawer.
6. admin **energy-rate detail** (`settings/energy-rates/[id]`) — was an
   `isEditing` swap of the whole read view; now read view stays put and
   **Edit** opens a Drawer (Playwright-verified).
7. admin **payment reconciliation** (`reconciliation/[id]`) edit panel →
   Drawer.
8. admin **whatsapp-templates** create form → Drawer.

9. partner-ui **design-production-section** (the 1576-line worst
   offender) — Finish form → `Drawer`, the multi-step Complete form
   (output / cost / materials / notes) → full-screen `FocusModal`.
   Playwright-verified against a seeded completable run (Finish drawer
   560px right-side; Complete focus-modal full-screen with the multi-step
   body). The `showMaterialForm`/`showCostInput` toggles stay nested
   inside the Complete modal.

All mirror the existing bulk-* drawers. partner-ui tsc clean. The
always-on tag input in `design-attributes-section` is left as-is (a
legitimate inline pattern, not an edit-form anti-pattern).

Several admin tables use ad-hoc inline-edit components. Medusa's
admin pattern is: row click → side drawer / dedicated edit page.
**First step:** inventory which routes use inline edit (designs,
people, raw materials are likely candidates), pick the worst-offender
first, port to drawer.
**Effort:** ~half day per route once the pattern's in place.

#### 3. Analytics submenu missing for some partners in partner-ui

**Status: FIXED 2026-06-06.** Not a data/backfill issue — the nav was
gated on `workspace_type` in `useCoreRoutes`
(`apps/partner-ui/src/components/layout/main-layout/main-layout.tsx`).
The `seller` branch's Web Store menu listed content + theme +
**analytics**; the `manufacturer` (default) branch's Web Store menu
listed only content + theme — analytics was omitted even though both
partner types get a Web Store and `/webstore/analytics` is registered
unconditionally in the route map (`get-partner-route.map.tsx:871`).
Decision (user, 2026-06-06): Analytics is a standard Web Store feature
→ show it for any Web Store partner. Fix: added the analytics nav item
to the manufacturer branch's Web Store `items`. Route was already
reachable, so no 404 risk.

The Analytics submenu appears for some partner accounts and not
others. Suspect: gated on `partner.workspace_type` or on a feature
flag that wasn't backfilled, similar shape to today's region bug.
**First step:** check the partner-ui sidebar component to see how the
Analytics entry is gated, then compare two partners (one who sees it,
one who doesn't) at the DB level.
**Effort:** 1-2 hours diagnosis, 1 hour fix.

#### 5. Tax config per store working as expected

**Status: AUDIT + E2E TEST SHIPPED 2026-06-04.** Branch
`feat/5-tax-coverage-audit-and-test`. Each partner shares the global
canonical tax_regions (PR #261); cart-tax lookup matches the
shipping address's country against `tax_region.country_code`. If no
row (or no default rate) exists for that country, the cart shows
`tax_total = 0` and the partner under-bills — silently.

Shipped:
- `apps/backend/src/scripts/audit-tax-coverage.ts` — walks every
  partner via `query.graph({ entity: "partner", ... })`, lists
  every country covered by their regions, and flags any country
  that lacks a tax_region row **with a default rate > 0**. Exports
  `computeTaxCoverage()` returning a typed report so tests + admin
  surfaces can consume it without log-scraping. Skips US/UM (no
  federal sales tax — partner handles state-level themselves).
- `integration-tests/http/tax-coverage-audit-and-cart.spec.ts` — 6
  tests covering: audit reports zero gaps for fully-covered partner,
  surfaces partner with AO (no curated rate), skips US correctly,
  TaxModule.getTaxLines returns AU=10% GST + IN=18% GST, returns
  zero for an unseeded country (the silent-undercharge scenario).

**Closed out 2026-06-05** — ran `./deploy/aws/scripts/run-backfill.sh audit-tax-coverage` on prod:

- **35 canonical tax_regions** with default rates exist
- **21 partners audited** (every live partner store)
- **0 gaps** — every partner-covered country has a canonical tax_region

**End-to-end verification (2026-06-05):** curled the prod store API (`/store/carts` + `/store/products` + line-items + shipping address) with Sharlho's publishable key against an AU shipping address. Cart returned `subtotal=66.70 AUD, tax_total=6.67 AUD, total=73.37 AUD` — effective rate exactly **10%** AU-GST. ✓

**IN follow-up shipped (PR #TBD):** the same probe against an IN shipping address showed `tax_total=5%` on a ₹4,999 variant. Researched: India's apparel/textile GST (post 22-Sept-2025 reform) is **5% ≤₹2,500/piece, 18% above**, and the threshold is per-piece price, not catalogue-wide. Sharlho's tax_region was set to flat 5% which is correct sub-₹2,500 and under-collects above.

Medusa's `tax_rate_rules` can only condition on `product`, `product_type`, or `shipping_option` — **not** on `unit_price`. We bridge the gap by auto-classifying products by max INR variant price:

- `seed-in-textile-tax-class.ts` creates a JYT-managed product_type (`jyt_tax_in_textile_over_2500`) + adds a non-default 18% rate on the IN tax_region with `rules: [{reference: "product_type", reference_id: <ptyp_id>}]`.
- `classify-product-tax-class` workflow + `product.created`/`product.updated` subscriber auto-assigns or clears the type as variant prices change.
- `backfill-classify-products-tax-class.ts` catches up the historical catalogue.
- The existing partner-ui at `apps/partner-ui/src/routes/tax-regions/tax-region-tax-override-create/` already lists + manages these overrides (supports product / product_type / shipping_option references).
- Documentation lives in `apps/docs/notes/TAX_NOTES.md` with the conservative max-price tradeoff for mixed-variant products.

`audit-tax-coverage` still flags IN-covering partners under `review_needed` so admins can spot-check classification health.

**Incident sidebar (worth memorialising):** while shipping this we hit a Copilot IAM gotcha — PR #315's `VISUAL_FLOW_FAILURE_EMAIL` SSM param was created without the `copilot-application=jyt` + `copilot-environment=prod` tags Copilot's auto-generated `SecretsPolicy` requires. Both #315 and #316 deploys silently failed for the same reason; server stayed on the pre-#315 task def. Fix was `aws ssm add-tags-to-resource` + re-run the workflow. Saved as memory `reference_copilot_ssm_tag_requirement`.

---

**Original problem statement (for the record):**

Each partner should have tax_regions provisioned for the countries
their regions cover (PR #261 seeded canonical tax_regions). Verify
end-to-end: order in AU calculates 10% GST, order in EU calculates
country-specific VAT, etc. Likely needs the same propagation as #0B.
**First step:** pick 2 partner stores, place test orders in AU/IN/EU,
assert tax line items are present and correct.
**Effort:** half day — likely surfaces gaps that turn into their own
sub-tasks.

#### 7. Theme editor workability + fix uniquepashmina.com layout

UniquePashmina's storefront layout is broken (visit to confirm
specifics). Theme editor itself needs more variability — currently
limited token surface.
**First step:** screenshot UP's broken layout, find the theme it's
on, diff against a working partner (e.g. GOF or Ielo), identify the
breaking config. Separately: enumerate theme tokens that need to be
configurable.
**Effort:** 2-4 hours for the UP fix, theme editor expansion is its
own larger track.

#### 9. Confirm partner email services work end-to-end

Email infrastructure exists; need to confirm partners actually
receive: order confirmations, followup nudges, region-request
notifications (the FX work added one). Likely needs reviewing
notification routing per channel.
**First step:** end-to-end: place a test order on GOF storefront, walk
through every email touchpoint, log which fire and which don't.
**Effort:** 2-3 hours testing + fixes as we find gaps.

#### 21. Fix layout issues in pagination-based panels on web-jyt

The marketing site (web-jyt) has layout regressions inside the
panels that paginate content — cards/tiles overflow or wrap
awkwardly, controls misalign on certain breakpoints. Add this once
we have a screenshot or page to repro against.
**First step:** capture the broken state per breakpoint (mobile /
tablet / desktop) on the offending panels, then fix in the
storefront-starter (or web-jyt directly if the panel lives there).
**Effort:** half a day depending on how many breakpoints regress.

#### 22. Restore the painting from the New York Gallery open archive

A painting tile from the NY Gallery (open archive section on
jaalyantra.com) is broken — likely a missing image asset or a
stale URL after a recent archive move.
**First step:** open the gallery page, identify the broken
painting, trace the asset source (S3 path / CDN URL / WordPress
import), restore or re-link.
**Effort:** 1-2 hours.

#### 25. Partner assignment on design production runs — diagnosed 2026-06-03

**Status: 25a + 25b + 25c SHIPPED & MERGED to main (verified 2026-06-06).**
Commits: `66c4eea78` (25a, `.nullish()` on both validators), the
`hasPerAssignmentTemplates` guard in the design production-run drawer
(25b), and `68d0a8902` → `93ab12772` → `06786c30a` (25c header
forwarding + a hardened reachable IMAGE-header fallback to dodge Meta
error 132012). **Re-seed of the prod flow still required** — delete
`vflow_01KQ9RSZ1TFMB7MQ0Y64P4E98Y` and re-run
`seed-partner-run-whatsapp-flow.ts` (see 25c below). 25d remains a
deferred follow-up.

Reported against prod run `01KPET5HBGNH9QXGC0MC8RHR39`. Investigation
reproduced the validator error on design `01JQ4H4JKX4TMXJZ3GH9TA02MT`
(test partner Saransh Sharma) and surfaced **three** related bugs, not
two:

**25a — Validator rejects `template_names: null` (FIX IN-FLIGHT).**
The admin UI's "Send to production" toggle sends
`template_names: null` when no global templates are picked, but
`AssignmentSchema.template_names = z.array(z.string()).optional()`
rejects null (only undefined or array is allowed). Result: the entire
request 400s with "Field 'assignments, 0, template_names' is required"
and the production run is never created, so no WhatsApp event ever
fires. Fix: switch to `.nullish()` on both
`apps/backend/src/api/admin/production-runs/validators.ts` and
`apps/backend/src/api/admin/designs/[id]/production-runs/validators.ts`.

**25b — Admin UI double-dispatches via `sendMutation` (FIX IN-FLIGHT).**
The route `POST /admin/designs/:id/production-runs` already
auto-dispatches each child whose `dispatch_template_names` is set from
per-assignment templates (route.ts:218–233). The form submit handler
in `src/admin/routes/designs/[id]/@production-run/page.tsx` then loops
again calling `sendMutation` with the **global** `values.template_names`
(empty when per-assignment templates were used) — hitting
`AdminSendProductionRunToProductionReq.template_names.min(1)` and
400ing. Fix: skip the manual loop when `hasPerAssignmentTemplates`
is true (backend already did the work).

**25c — `header_image_url` forwarded to no-header templates** (FIX
IN-FLIGHT). Verified against Meta's actual deployed config via
`GET /admin/social-platforms/whatsapp/templates`:
`jyt_production_run_assigned_v3` (en + hi, status APPROVED) has BODY +
BUTTONS but **no HEADER component** — yet the seeded visual flow's
`send_whatsapp` operation unconditionally forwards
`header_image_url: "{{ resolve_template.design_image_url }}"`. Meta
rejects with code 132018 ("Template does not contain title component,
no parameters allowed") and the WhatsApp never sends. Same shape for
`jyt_production_run_cancelled_v3` + `jyt_production_run_completed_v3`.
The 3 reminder templates are unaffected — they were approved with an
IMAGE header.

Fix: `seed-partner-run-whatsapp-flow.ts` map gains a `has_header`
flag per event. The resolve_template code returns
`design_image_url: config.has_header ? designImageUrl : null`. The
existing `send_whatsapp` operation already skips the header
component when the URL resolves to empty, so no operation-side
change is needed. **Re-seed required in prod** after merge —
delete the existing flow `vflow_01KQ9RSZ1TFMB7MQ0Y64P4E98Y` and
re-run `npx medusa exec ./src/scripts/seed-partner-run-whatsapp-flow.ts`.

**25d — Partner profile missing whatsapp_phone_number** (FIXED
2026-06-06, GitHub #335). Saransh's partner profile has no `phone` /
`whatsapp_phone` / `whatsapp_phone_number` on any field — but the
seed's resolve_template falls back to the first active admin's
`phone` (which prod payload showed populated), so partner-side
WhatsApp does have a phone target. We now surface a clear admin
warning when assigning a partner without a reachable WA contact:
- `GET /admin/persons/partner` computes a `has_whatsapp_contact`
  boolean per partner, mirroring the seed's resolution priority
  exactly (verified `whatsapp_number`, else any active admin with a
  `phone`). The list endpoint now fetches `whatsapp_number`,
  `whatsapp_verified`, `admins.phone`, `admins.is_active` for the
  computation (response shape was already fixed, so additive).
- `AdminPartner` hook type gains the optional `has_whatsapp_contact`.
- The design production-run assignment modal
  (`designs/[id]/@production-run/page.tsx`) shows an orange
  `ExclamationCircle` warning under the partner select when the chosen
  partner's `has_whatsapp_contact === false`. Non-blocking.
- Test: `integration-tests/http/partner-has-whatsapp-contact.spec.ts`
  (2 tests — admin-with-phone → true, no-phone → false), green.

**Effort:** 25a + 25b + 25c shipping in this PR. 25d is a small
follow-up admin affordance.

#### 26. Email notification when a visual flow fails

**Status: SHIPPED 2026-06-04.** Branch `feat/26-visual-flow-failure-email`.
Expanded from the original spec — covers **start + failure** lifecycle
hooks, not just failure (user picked the broader shape so admins also
notice flows that began but never landed). The shipped surface:

- `apps/backend/src/workflows/visual-flows/execute-visual-flow.ts` —
  emits `visual_flow_execution.started` after the execution row goes
  to `running`, and emits `visual_flow_execution.failed` from the
  compensation path. The compensation now reads the latest failure
  row from `visual_flow_execution_log` so the failed event carries
  the **real** operation error (not the generic
  `"Workflow cancelled during execution"`) plus the
  `failing_operation_key`. The execution row's `error` field gets the
  same upgrade.
- `apps/backend/src/subscribers/visual-flow-lifecycle-email.ts` —
  listens on `["visual_flow_execution.started",
  "visual_flow_execution.failed"]`. Recipient resolution:
  `flow.metadata.failure_email` → `VISUAL_FLOW_FAILURE_EMAIL` env →
  bail silently. In-memory throttle keyed by
  `started:<flow_id>` or `failed:<flow_id>:<fingerprint>`; ULID-aware
  fingerprint (`[0-9a-z]{12,}` collapses Crockford base32 ids) keeps
  identical-shape errors in the same bucket.
- `apps/backend/src/scripts/seed-visual-flow-lifecycle-email-templates.ts` —
  upserts both `visual-flow-started` and `visual-flow-failure`
  templates so admins can edit the body/subject in the admin UI
  without a redeploy.
- 2 integration tests in
  `integration-tests/http/visual-flow-lifecycle-email.spec.ts` —
  end-to-end lifecycle event capture against a flow with an
  `execute_code` step that throws, plus a fingerprint unit test on
  ULID-shaped messages.

**Re-seed required after deploy:**
`npx medusa exec ./src/scripts/seed-visual-flow-lifecycle-email-templates.ts`.

---

**Original problem statement (for the record):**

Direct follow-up to the 25c diagnosis. Today, when a visual-flow
execution errors out (a Meta API rejection, a missing
template, an unreachable image URL, a thrown step) it lands as
`status=cancelled` with the unhelpful generic message
`"Workflow cancelled during execution"` and nobody finds out until
someone reports the downstream symptom (partner says "I never got a
WhatsApp"). The 25c bug went undiagnosed for days because of
exactly this silence.

Fix: hook a notification on flow-execution failure that sends an
admin email summarising the failure — flow name, execution id,
event/trigger, the failing operation key + the error message Meta
or the runtime returned. Use the existing `email_templates` system
(see `apps/backend/src/api/admin/email-templates/` and the
`partner-created-from-admin` template used by partner provisioning)
so admins can edit the body / variables in the admin UI without a
deploy. Recipients: configurable per flow (`flow.metadata.failure_email`
or a global `VISUAL_FLOW_FAILURE_EMAIL` env var fallback).

Implementation outline:
- Subscriber on `visual_flow_execution.failed` (or
  `visual_flow_execution.cancelled` if there's no `.failed` event yet —
  add one in the execution engine).
- Lookup the flow's owner / configured recipient. Fall back to env.
- Render `visual-flow-failure` email template with: flow name, exec
  id, event name, trigger payload (truncated), failing operation
  key, error text, link to the admin execution-detail page.
- Send via the existing email provider (Mailjet / whatever is wired).
- Throttle per flow_id + error fingerprint to avoid duplicate
  flood when a broken template fans out 100 reminders in one minute.

**Effort:** 2-3 hours for the subscriber + email template + throttle.
Plus a one-line seed for the email template body.

#### 27. Auto-link partner to design on production-run assignment

**Status: SHIPPED 2026-06-04.** Branch `feat/27-design-partner-auto-link`.
Surfaced earlier the same day testing partner-side visibility after
the bug-25 fix. Design `01KPET5HBGNH9QXGC0MC8RHR39` ("White Envelope Dress")
was originally linked in `design_partners_link` to Shramdaan. Admin
then created a production run + assigned it to Sharlho (Tarunsharma).
Sharlho can see the production run in `/partners/production-runs`
(filtered by `run.partner_id`) but the design **doesn't** appear in
`/partners/designs` — that endpoint queries `design_partners_link`,
which the production-run-assignment path never updates. Two sources
of truth that drift on re-assignment.

Desired behavior: **additive multi-partner.** A design can have many
partners, and assigning a production run to a partner should
automatically upsert a `design_partners_link` row for that
(design, partner) pair without removing any existing link rows.
Explicit assignment via the admin design-partner UI continues to
work as a separate path. `design_partners_link` is already
`isList: true` on both sides, so the schema supports multi already.

Fix outline:
- `approveProductionRunWorkflow` gains a `linkPartnersToDesignStep`
  that iterates over `assignments` (post-creation), looks up existing
  `design_partners_link` rows for the (design_id, partner_id) pair,
  and creates only the missing ones. Idempotent + safe to re-run.
- One-shot backfill script `backfill-design-partners-from-runs.ts`
  walks every existing non-cancelled production run with a
  `partner_id` + `design_id` and creates the missing link rows.
  Mirrors the `backfill-all-admin-regions-to-partners.ts` recipe
  from 0A — dry-run aware, scoped via `--partner-ids` /
  `--design-ids`, surfaced via `run-backfill.sh`.

**Shipped:**
- `linkDesignToPartnersStep` added to
  `apps/backend/src/workflows/production-runs/approve-production-run.ts`.
  Runs after the children are created, upserts only the
  missing `(design_id, partner_id)` pairs, and has a rollback that
  dismisses just the rows it created.
- `apps/backend/src/scripts/backfill-design-partners-from-runs.ts`
  walks every non-cancelled production_run with `partner_id` +
  `design_id`, creates the missing link rows. Mirrors the 0A recipe:
  `DRY_RUN=1`, `--partner-ids` / `--design-ids` scoping, error
  surfacing, exit code 1 on failures.
- 7 integration tests in
  `integration-tests/http/production-run-design-partner-auto-link.spec.ts`
  covering auto-link on first assignment, idempotency, additive
  behaviour, `/partners/designs` visibility, plus the backfill
  scenarios (recovery, no-op, dry-run).

**Closed out 2026-06-04** — backfill ran on prod via
`./deploy/aws/scripts/run-backfill.sh backfill-design-partners-from-runs`
(dry-run first, then real). 17 (design, partner) pairs walked, 16
already linked, 1 created: design `01KPET5HBGNH9QXGC0MC8RHR39` ↔
partner `01K4PJMNMNRGMK0ZXMKBBDZDGD` (Sharlho) — exactly the drift
reported. Zero errors.

### Partner platform extensions

#### 4. Per-order transaction fee billing per partner

Currently charging 3% per order as a transaction fee. Needs to be
modeled per-partner so different tiers can pay different rates and
the fee shows up in partner statements.
**First step:** decide where the fee lives (line item on order?
separate `partner_fee_event` table? Stripe Connect application fee?),
then design the model + admin surface to set the rate per partner.
**Effort:** 1-2 days for the model + UI; depends on Stripe Connect
flow if going that route.

#### 6. Promote admin features to partner-ui (starting with Designs)

Designs is admin-only today. Partners would benefit from running
their own design pipeline. Pattern is the same as the existing partner
parity work: mirror the admin API under `/partners/...` with scoping.
**First step:** parity audit on the designs module — what endpoints
exist in admin, what needs to be added to partners. Use the
PARTNER_API_PARITY.md recipe.
**Effort:** 2-3 days end-to-end, plus tests.

#### 24. Standardise partner-ui orders onto the Medusa `order` entity

Today partner-ui surfaces two parallel order concepts — `design_orders`
and `inventory_orders` — each with its own modules, APIs, partner
routes, lifecycle workflows, and UI screens. The underlying intent
(partner receives work, partner does work, partner gets paid) is the
same; only the artifact differs (a design vs a raw-material PO). The
fragmentation costs us in three places: partners learn two mental
models, status/notification logic duplicates, and every new
cross-cutting feature (FX, tax, partner statements, audit) ships
twice.

Consolidate by promoting Medusa's core `order` entity to the single
home for partner work-orders, distinguishing the two flavours by
`order.metadata.kind in (design, inventory)` (or a typed extension
column). Keep the existing route paths as shims that translate to the
unified order under the hood — no breaking changes for live
storefronts or the partner SDK — while folding the actions
(accept / decline / mark shipped / etc.) into a single set of UI
panels driven off `order.status` + `order.metadata.kind`.

**Why now:** it's pre-condition work for several backlog items —
per-order transaction fee billing (#4), partner statements, and the
FX/region propagation work all need a single order surface to act on
rather than two parallel ones.

**First step:** write a small mapping doc — for each
`design_order` and `inventory_order` field, where it lives on
`order` + `order_line_item` + `order.metadata`. Identify the gaps
(fields that don't fit cleanly) and decide column extension vs.
metadata. Then a thin shim PR that creates one new
`order.metadata.kind` order alongside an existing legacy create, to
validate the model without removing anything yet.

**Effort:** 1 day for the mapping + shim, then 3-5 days to migrate
the partner-ui panels onto the unified surface and quietly
back-migrate existing rows.

#### 8. Menu / submenu wizard for partner-ui personalization

Today every partner sees the same sidebar. Wizard lets the partner
hide modules they don't use, pin their most-used routes, etc.
**First step:** decide the storage shape (`partner.metadata.sidebar`
vs a new `partner_ui_prefs` model), wireframe the wizard.
**Effort:** 1 day for storage + simple UI, more if we want
drag-and-drop reorder.

#### 11. LLM chat in the theme editor

In-editor chat that takes natural-language requests ("make the
header sticky", "swap the primary font to serif") and applies them
to the theme config.
**First step:** scope what subset of theme tokens the LLM can touch
safely, decide model (Claude via existing infra?), wire a minimal
chat panel that emits structured edits.
**Effort:** 2-3 days for v1; ties into #7 (theme editor work).

#### 16. Ad planning + conversion tracking for partner products

We have the `ad_planning` module and `track_conversion` endpoints
already. Need to expose per-partner so they can plan campaigns for
their own products + see conversion data.
**First step:** parity audit on ad_planning module (same recipe as
#6). Decide whether partners run their own Meta ad accounts or share
a JYT umbrella account.
**Effort:** 1-2 days for the parity surface, more if we wire Meta
ad-account onboarding per partner.

#### 20. Share-publicly UX on the stats-panel editor

**Context:** PRs #281 + #283 + #284 walked us through what the
"shareable panel" surface needs to actually look like.
- #281 added `GET /web/stats/panels/:id/data` + a
  `metadata.public === true` opt-in gate + an `isPanelPublic` helper
- #283 reverted the gate on the blog injector — admin authoring is
  the auth there; the gate broke the editor flow because every
  embedded panel rendered as "data not available" until someone
  separately PATCHed the flag
- #284 removed the REST endpoint and the unused helper. Only path
  exposing panel data outside admin today is the blog injector

What we actually want, when we get back to this:
1. **Panel editor UI** — when an admin saves a panel, a checkbox
   "Share publicly" sets `metadata.public: true`. Off by default.
2. **Visible affordance** — when public, surface a copy-link to the
   public REST URL (re-add `/web/stats/panels/:id/data`) so admins
   can hand it to a third-party dashboard / status page / blog
   author without picking through metadata.
3. **Audit fields** — `metadata.public_set_by` (admin id) +
   `metadata.public_set_at` for trail when it's flipped.
4. **Restore the helpers** — `isPanelPublic` + the REST endpoint
   come back exactly as #281 had them. The strip
   (`stripExcludedColumns`) is already in place for column-hiding.

**Why deferred now:** without the editor UI, the gate is friction —
admins forget to flag panels, blog embeds break silently. Better to
build the path through the editor in one go than retrofit a hidden
metadata field.

**First step:** wireframe the panel-editor settings tab + decide
where the public-link lives (panel detail page sidebar? action menu?).
**Effort:** 1 day for the editor toggle + REST endpoint restore +
helper restore, +0.5 day for the link/affordance UI.

### Infrastructure / SaaS posture

#### 10. Dedicated instance per partner (Pro tier)

Already scoped in `project_medusa_saas_vision.md` + `SAAS_TIERS.md`.
Active path: AWS Fargate provisioning per partner. Deferred until
first paying Pro customer asks (per `feedback_focused_regions_fx_conversion.md`).
**First step:** wait for paying-Pro signal; meanwhile keep
`deploy/aws/PLAN.md` current as we learn from Shared-tier ops.
**Effort:** weeks once green-lit.

#### 13. Cloudflare offload for analytics / visitor data

Move visitor analytics ingestion to Cloudflare Workers (away from
Medusa Fargate) so the main app isn't taking the analytics write load.
**First step:** confirm volume — pull current analytics write rate to
size the Workers tier needed. Decide between Workers Analytics Engine
vs forwarding to existing pipeline.
**Effort:** 1-2 days for the Worker + ingestion wiring.

#### 14. Netlify support for new partner storefront provisioning

Today we provision to Vercel only. Add Netlify as a second target so
partners can pick (or so we can fail over).
**First step:** look at `provision-storefront.ts` workflow, factor
out the Vercel-specific calls behind an adapter interface, write the
Netlify adapter.
**Effort:** 1-2 days.

#### 17. Multiple-domain support for partner storefronts (`www.` + apex)

Right now we provision a single domain. Partner sets `ielocraft.in`
but a visitor going to `www.ielocraft.in` hits SSL errors. Need both
hosts on the cert + a redirect rule.
**First step:** confirm what Vercel's Domains API takes for a
www+apex pair, update the provision workflow to register both, add a
permanent redirect from one to the other.
**Effort:** half day on Vercel side + apex/www DNS docs for partners.

### Auth + compliance

#### 15. Google OAuth + MFA at partner/admin

Add Google login (Sign in with Google) + TOTP MFA for partner-ui and
admin sessions.
**First step:** check whether Medusa 2.x has a Google auth strategy
plugin we can reuse; for MFA, decide TOTP vs WebAuthn.
**Effort:** 1 day Google, 1-2 days MFA.

#### 18. JYT/KHT tax-ID fallback when partner has none

If a partner hasn't supplied a tax ID, bill orders under JYT or KHT
(brand-dependent) tax IDs as a fallback so invoices stay legally
valid.
**First step:** decide trigger (per-order at invoice time?
per-partner setting?), then update invoice generation to substitute.
**Effort:** half day, larger if compliance review needed.

### Growth + content

#### 12. Google search indexing for partner storefronts

Make sure each partner storefront serves valid `sitemap.xml`,
`robots.txt`, structured product data (JSON-LD), and is verified in
Search Console.
**First step:** crawl one partner storefront with Lighthouse SEO,
catalog gaps, fix the storefront-starter template once for all.
**Effort:** 1 day.

#### 19. Import handloom partner data across India

Source partner candidates from public registries (Handloom Board,
state-level handloom co-ops, INTACH), enrich with location +
contact, load into the persons module so they show on the
`/map` page.
**First step:** identify 1-2 source registries, hand-curate a 50-row
CSV first to validate the schema, then write the importer.
**Effort:** 1 day for the importer, ongoing for sourcing.

#### 23. Browser extension — design moodboard clipper

A Chrome / Firefox extension that logs into the JYT API (admin or
partner auth) and lets the user clip images from any web page
straight into a design's moodboard. Walks the DOM of the active
tab, extracts `<img>` src + alt + nearby caption text, lets the
user pick which to keep, and POSTs them to
`/admin/designs/:id/moodboard` (or the partner equivalent). Same
flow useful for collecting raw reference data — patterns, fabric
swatches, gallery images — without the manual "save image →
upload to admin" loop.

**Why this is high-leverage:** designers already source references
from Pinterest / Behance / museum archives. Today every reference
takes a download + admin upload + tagging round trip. Reducing that
to one click while browsing is a clear ergonomic win and unblocks
faster moodboard-driven design briefs.

**First step:** scaffold a minimal MV3 extension (manifest +
popup + content script), wire admin-token storage (settings page
with paste-the-key UX), implement `<img>` harvest on the active
tab, then the POST. Pick which design to attach via a search
combo box backed by `/admin/designs?q=…`.
**Effort:** 2-3 days for a usable v1; ongoing polish for the
selection UX, dedup, and HEIC/AVIF support.

---

## Suggested working order for the week

Best-batched-together rough sequencing:

| Day | Focus | Items |
|---|---|---|
| **Tue 05-27** | Unblock live traffic | **#0A** (one-off region link + currency + fanout for all partners), spot-check storefronts |
| **Wed 05-28** | Close the bug holes | **#1, #3, #7 (UP fix only)** — small UI fixes |
| **Thu 05-29** | Region propagation done right | **#0B** + **#5** (verify tax flows after propagation) |
| **Fri 05-30** | Email + ops | **#9, #17** |
| **Mon 06-02** | Money model | **#4** transaction fee billing |
| **Tue 06-03** | Partner parity track | **#6** (Designs to partners) |
| **Later** | **#10, #11, #13, #14, #15, #16, #18, #19** — pick from the deck as priorities shift |

### Carry-forward to next plan
- Theme editor expansion (the bigger half of #7) — needs design input
- LLM chat in editor (#11) — depends on #7 token scoping
- SaaS Pro instance (#10) — paused until first paying signal

---

## Cross-cutting reminders

- Every partner-facing API change goes through the parity audit
  (`PARTNER_API_PARITY.md` recipe) before shipping
- Anything that touches Medusa events / price metadata / link tables
  needs the "one true e2e" rule from `MEDUSA_PRICING_QUIRKS.md`
- New env vars / module registrations land in BOTH `medusa-config.ts`
  and `medusa-config.prod.ts` (CI guard exists, don't skip it)
- Smoke-test affected partner storefronts after any region / pricing
  / tax change; Ielo + GOF are the two highest-traffic real-money
  ones to use as canaries
