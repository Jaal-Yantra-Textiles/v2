# Sequenced work plan — from 2026-09-11

Written because 2026-09-10/11 drifted: the session opened with six next-steps,
finished one, and spent the day on an emergent shipment. The shipment was worth
doing — it was blocking real money — but four items were never touched and one
of them is a **live risk**.

Each slice below is one session's work. Take them **in order**. Do not start a
slice until the previous one's "Done when" is true, unless something is on fire.

**Ordering principle:** live risk → prevention → known-broken → expansion.
A defect that is silently costing money outranks a feature that would be nice,
and a gate that stops a class of defect outranks fixing one instance of it.

---

## Slice 1 — stop the live bleeding

Nothing here is new work; it is all "a wrong number can reach a customer today".

> **Status 2026-09-16:** 1a is **done** (verified against prod, not assumed).
> 1b, 1c and 1d are **still open**. See the session log at the bottom for what
> displaced them.

### 1a. #1979 — 40 designs will mint at ~110× ✅ **DONE** (verified 2026-09-16)

`resolveApprovalCurrency` read `designCurrency || storeCurrency || "inr"`. JYT
Medu Store's default is EUR, so a design costed in INR minted in EUR: the tweed
jacket went out at €2,634.75 → **₹291,560**. The INR fallback was written for
exactly this case and was unreachable.

- [x] **Resolver fixed.** `storeCurrency` is now absent from the input type
      entirely — deliberately, so that re-adding it has to be a deliberate edit
      rather than a plausible-looking `||`. The rule it encodes: *a cost is
      denominated by how it was COMPUTED, not by where the garment is SOLD.*
      A run's own `cost_currency` is asked first, then the design's, then INR.
- [x] **Backfill complete.** Measured on prod 2026-09-16: **48 costed designs,
      48 with `cost_currency`, all `inr` — zero missing.** The plan's
      "42 of 43 have none" is out of date.
- [x] **Regression tests** in `workflows/production-runs/__tests__/`
      (`approval-pricing.unit.spec.ts`, `house-store.unit.spec.ts`).

🔑 `approvalCurrencyWasAssumed()` exists so a price whose currency was GUESSED
can still be said out loud. It tests the RAW field before coercion, because
`""` is falsy but not null.

**Verification method**, for whoever re-checks this: count designs with a
non-empty `estimated_cost` and compare against those with a non-empty
`cost_currency`. They were 48 and 48. Do not infer "costed" from a single
guessed field name — `estimated_cost`, `material_cost`, `production_cost` and
`raw_*` twins all exist, and picking the wrong one returns a confident nothing.

⚠️ `0` is not `null` and `Number(null)` is `0`. Ask `> 0`, not `!= null`, and
test the RAW field before coercing.

### 1b. The payment-link fallback lies to the customer

`preparePaymentCollection` catches EVERY error and returns null, so the page says
*"This payment link is not valid"* for a backend that is down, unreachable, or
mid-deploy — telling a paying customer their link is bad when the fault is ours.
Observed live: the storefront deployed before the backend, and a valid link read
as invalid.

- [ ] Return a discriminated result (`ok` / `not_found` / `unavailable`) instead
      of collapsing to null.
- [ ] "Unavailable" renders "we're having trouble reaching our system, please try
      again in a few minutes" — never "your link is invalid".

**Done when** a 404-for-collection and a 500/unreachable backend render
different messages.

### 1c. Verify the live payment link end to end

- [ ] `https://cicilabel.com/<cc>/payment-collection/pay_col_01M25NHFRS…` renders
      the order, the balance explanation, and an ENABLED Pay button.

### 1d. Sweep the remaining 10-digit HS codes

Three variants still carry them (Medium tweed, the Pashmina `6214200000`, other
colours). Shiprocket accepts **6 or 8 digits only**; they will fail identically
on their next international booking.

**Done when** no variant carries a code that is neither 6 nor 8 digits.

---

## Slice 2 — the readiness gates (#1980)

The highest-leverage item on the board, and the one the last two sessions kept
deferring. Both scenarios recorded on #1980 were *discovering what was missing,
one failed operation at a time*. Build the gates before more workflows.

### 2a. `product-readiness`

Given a product, answer BEFORE anyone tries to sell or ship it:

- [ ] has a **shipping profile** (#1982 — 22 of 97 had none)
- [ ] has a **price** in the store's currency
- [ ] is in a **sales channel** (`create_product` binds none)
- [ ] has **inventory levels** (`create_product` seeds none)
- [ ] has an **HS code of exactly 6 or 8 digits** (#1984)
- [ ] has a **weight**

### 2b. `shipping-readiness`

Given an order and a set of lines:

- [ ] each line's product profile **matches the order's shipping option**
- [ ] each line has a 6-or-8-digit HS code
- [ ] each `manage_inventory` line has a **reservation at the shipping location**
- [ ] the selected lines are **uniform in `requires_shipping`**
- [ ] destination serviceable; origin pickup registered AND phone-verified
- [ ] weight + dimensions present and **physically plausible** — the first real
      figures were 1700 g in 10×11×8 cm, i.e. 1.9 g/cm³, denser than water.
      They were inches. A density check catches that before a carrier does.

**Done when** both gates run against live prod data and their output would have
predicted every failure in the 2026-09-10 shipment.

`check_quote_readiness` is the sibling to model on.

---

## Slice 3 — close the notification loop (#1988)

A customer currently learns nothing between order confirmation and delivery.

- [ ] **Founder, one dashboard look:** is Shiprocket's webhook pointed at
      `https://v3.jaalyantra.com/webhooks/shipping/track`, with the
      `SHIPPING_WEBHOOK_SECRET` from SSM? Nothing in the API exposes this.
      Evidence says it has **never** fired for a core order: the one delivered
      fulfillment has EMPTY `data` and `shipped_at: None`, i.e. hand-marked.
- [ ] A **Shiprocket polling backstop**, mirroring `poll-delhivery-tracking`
      (Delhivery-only today). A webhook that silently stops is indistinguishable
      from "no parcels moved".
- [ ] An **AWB-assigned** notification — a NEW key (`order-awb-assigned`), never
      a second active row on an existing key.

⚠️ The 67 templates already exist and are ACTIVE. Senders resolve the FIRST
active row per key, so adding duplicates is worse than the current state.

**Done when** AWB `8327967800746` moving through Shiprocket advances the
fulfillment and sends an email without anyone touching it.

---

## Slice 4 — make `create_product` produce a usable product (#1982, #1984)

Fix the source of what Slice 2 merely detects.

- [ ] `shipping_profile_id` on `create_product` and `create_product_for_partner`
      — and **defaulted** when omitted, resolved like `pickTargetProfileId`.
- [ ] Narrow the `DELIBERATELY_OMITTED` note to `update_product` (reassignment),
      and add `create_product` to the coverage spec — it is not in it at all.
- [ ] A **writer** for `line.metadata.hsn` so an operator can supply a code at
      fulfillment time. The read rung exists and nothing writes it.
- [ ] Validate **exactly 6 or 8 digits** at write time in `bulk_set_hs_codes`.

⚠️ `updateOrderLineItems` MERGES metadata and cannot delete a key.

**Done when** a product created through MCP passes `product-readiness` unaided.

---

## Slice 5 — partner / multi-tenant expansion

- [ ] **#1983 — fix `create-store-with-defaults.ts:488` FIRST.**
      `listShippingProfiles({}, { take: 1 })` has no filter and no ordering. It
      is correct only by accident while ONE profile exists; a second makes every
      new partner store's profile nondeterministic, silently.
- [ ] Then create the partner shipping profile and repoint partner options.
- [ ] Port `/payment-collection/:id` to **`apps/storefront-starter`**.
      🔴 `loadStripe()` must be in a `"use client"` module — in a server
      component the Promise cannot cross the RSC boundary, nothing throws or
      logs, and the Pay button is permanently disabled.
      The starter is a **submodule** (own commit + pointer bump) and Next 15.
- [ ] A **per-tenant payment link**. `admin.storefrontUrl` is ONE build-time
      constant (`https://cicilabel.com`), so partner orders link to the house
      shop. Needs the core copy action overridden, or a backend redirect that
      resolves the tenant from the collection.

---

## Slice 6 — the stragglers

- [ ] **#1972** design re-approval 500s — on #1924's critical path
- [ ] **#1986** graph view draws no product for a design that has one. The link
      READS fine (`list_design_products` → count 1); hypothesis is the canvas
      derives it from a run, and the older run pair carries `product_id: null`.
      Not yet diagnosed — read the graph's own query first.
- [ ] **#1966** price-write tool · **#1970 item 1** size × colour
- [ ] `order_01KNP520` line `…HCW4XC` (Floral Prints) still has
      `variant_id: null` — cannot carry an HS code or be fulfilled.
- [ ] **Shiprocket dashboard** (founder): warehouse `76349863` still reads
      "Himachal Nagar"; their API has **no update endpoint** (verified by
      probing, 404 control vs 405 on `addpickup`). Its phone/email have also
      drifted from ours.

---

## Rules for running this plan

1. **One slice per session.** Post a Handoff comment on every touched issue and
   refresh the #352 pointer before the session ends.
2. **If something emergent arrives** (as the shipment did), finish it — then say
   explicitly which slice items were displaced, rather than letting them vanish.
3. **Render the screen.** The payment page passed every non-visual check —
   200, right title, right amount, `client_secret` in the payload, zero console
   warnings — with a completely dead Pay button.
4. **Read the row back.** A 200 is not evidence; several routes here echo a
   stale or partial body.
5. **Run a 404 control.** Auth and publishable-key middleware answer BEFORE
   routing, so a missing route and a real one both return the same status.

---

## Session log — what actually happened

Rule 2 below says an emergent session must name the slice items it displaced
rather than let them vanish. This is that record.

### 2026-09-16 — displaced ALL of Slice 1 except 1a

**Nothing in Slice 1b/1c/1d was touched.** The session ran on the #352 handoff
queue and on emergent findings instead. What it did:

| shipped | what |
|---|---|
| #2086, #2087 | merged from the previous session's queue |
| **#2088** | the intermittent Docker image build — diagnosed and fixed |
| **#2089** | `update_product_variant` can set `prices` |
| #2090 | partner coverage counted a PAGE as a total ("Europe 31/30") |
| #2091 | a design sold as several variants can finally be quoted |
| #2092 | start a design order from the Design Orders screen |

Prod data fixed: orphan mirror #107 (₹14,000 reading as a retail sale) retired;
4 test carts retired; `Linen 40 lea` priced at ₹700 — it was a selectable,
unbuyable weave.

**#1998's open checkbox closed:** Shiprocket genuinely quotes — US **$9.37**,
UK **£4.42**, Nigeria **$18.11**, tested as a customer through `/store/*`.
🔑 `GET /store/shipping-options` returns the option with `amount: null`;
only `POST /store/shipping-options/:id/calculate` distinguishes a working lane
from a dead one. Listing is not quoting.

### Things this plan should know, found on the way

- 🔴 **`check:prod-build` fails on `main` locally** — `@jest/core` unresolved in
  `generate-integration-test.e2e.spec.ts`. Confirmed pre-existing by stashing
  all changes and rebuilding. It is a PHANTOM dependency: declared in no
  `package.json`, not hoisted to the root, two peer variants in the store.
  **CI's `prod-build` passes while this fails**, so the gate does not see it.
  Same family as the bug #2088 fixed. Needs an issue.
- **`shamefully-hoist=true` gives the repo ONE version slot per package**, and
  an unpinned slot is a coin flip. That is what #2088 was. Pin in the ROOT
  `package.json` — a `pnpm.overrides` pin also works and costs partner-ui
  **+6375 type errors** (1096 → 7468). Measure before shipping a rule change.
- **`pnpm-lock.yaml` is in the path filter of EIGHT workflows**, including
  `deploy-investor-ui` and `deploy-analytics`. Any lockfile change ships those.
- **partner-ui's CI type gate only checks files the PR changed**, so a PR that
  touches no partner-ui source reports "all clean" regardless of what it breaks
  there. Its whole-tree count is the number CI cannot see.

### Stale entries corrected

- **1a** — done; the plan's "42 of 43 designs have no `cost_currency`" is now
  48 of 48 WITH one.
- The work graph carried `storefront-tests-not-in-ci` and
  `workflow-schemas-stale` as open; both were already fixed (#2079, #2087).

**An audit verdict is a claim about the PAST.** Re-check before acting on any
line in this document — three entries were stale within six days.
