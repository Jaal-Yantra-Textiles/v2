# Platform Roadmap — Open Backlog (captured 2026-05-26)

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

The dropdown doesn't render cleanly — likely a portal / overflow /
z-index issue (same family as the FX badge bug from this morning).
**First step:** reproduce in admin, screenshot the broken state, grep
for the raw-materials form component, check whether it's using
Combobox vs a custom select.
**Effort:** 1-2 hours.

#### 2. Replace inline editing with Medusa standards across admin

Several admin tables use ad-hoc inline-edit components. Medusa's
admin pattern is: row click → side drawer / dedicated edit page.
**First step:** inventory which routes use inline edit (designs,
people, raw materials are likely candidates), pick the worst-offender
first, port to drawer.
**Effort:** ~half day per route once the pattern's in place.

#### 3. Analytics submenu missing for some partners in partner-ui

The Analytics submenu appears for some partner accounts and not
others. Suspect: gated on `partner.workspace_type` or on a feature
flag that wasn't backfilled, similar shape to today's region bug.
**First step:** check the partner-ui sidebar component to see how the
Analytics entry is gated, then compare two partners (one who sees it,
one who doesn't) at the DB level.
**Effort:** 1-2 hours diagnosis, 1 hour fix.

#### 5. Tax config per store working as expected

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

**25c — WhatsApp doesn't fire even when the run reaches
`sent_to_partner`** (SEPARATE TRACK). Once 25a + 25b are fixed, the
event `production_run.sent_to_partner` does fire and the
`Partner WhatsApp — Production Run (all events)` visual flow
(`vflow_01KQ9RSZ1TFMB7MQ0Y64P4E98Y`) does match — but executions show
up as `status=cancelled` with `"Workflow cancelled during execution"`
(unhelpful). Saransh's partner profile also has no `phone` /
`whatsapp_phone` / `whatsapp_phone_number` set on any field, so even
a successful flow has no target. Two follow-ups:
- Diagnose the cancelled flow executions — likely a step error swallowed
  into a generic cancel. Inspect the resolve_template code node + the
  send_whatsapp operation logs.
- Backfill / enforce a `whatsapp_phone_number` on the partner profile
  (or surface a clear admin-side warning when assigning a partner with
  no WA contact — silent skip is worse than visible failure).

**Effort:** 25a + 25b shipping now. 25c is its own diagnosis session
(~2-3 hours).

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
