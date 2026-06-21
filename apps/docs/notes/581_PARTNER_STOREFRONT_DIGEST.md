# #581 — Per-Partner Storefront Analytics Digest

A weekly email digest of each partner's storefront analytics (KPIs +
breakdowns + rule-based suggestions). Built as a 4-slice stack reusing the
#569 analytics overview + #559 breakdown engines.

## Slices / PRs

| Slice | What | PR | Branch base |
|-------|------|----|-------------|
| S1 | Digest **compute** — pure `partner-digest-lib.ts` + `get-partner-storefront-digest` workflow | #582 | main |
| S2 | Digest **email** — `partner-digest-email-lib.ts` + `send-partner-digest-email` workflow (`email_partner`/Maileroo) | #583 | #582 |
| S3 | Visual-flow **op** `partner_analytics_digest` (fans out over partners, output `digests[]`) | #584 | #582 |
| S4 | **Seed** the weekly flow + this doc | #585 | main |
| S5 | (optional) AI suggestions via `ai-extract`, flagged | — | — |

**Merge order:** #582 (S1) first, then #583 / #584 (both stack on S1), then
S4's seed is independent (string refs only). The seed flow won't run
end-to-end until S1+S2+S3 are merged and deployed.

## Runtime graph (the seeded flow)

```
schedule (weekly, Mon 09:00 IST)
  → partner_analytics_digest            (S3 op; no selector ⇒ all active partners)
      • each partner's digest = S1 getPartnerStorefrontDigestWorkflow
      • per-partner errors swallowed (continue_on_error)
      • output: { digests[], count, with_storefront, with_suggestions,
                  suggestion_count, requested, failed, errors }
  → bulk_trigger_workflow               → send-partner-digest-email (S2)
      • items: {{ compute_digests.digests }}
      • input_template: { digest: "{{ item }}" }   (S2 takes a pre-computed digest)
      • one best-effort send per partner; admins resolved inside S2
  → log (observability summary line)
```

Seed script: `apps/backend/src/scripts/seed-partner-analytics-digest-flow.ts`
(idempotent; refuses to overwrite). Run:
`npx medusa exec ./src/scripts/seed-partner-analytics-digest-flow.ts`.

## Cadence (locked)

- Cron **`30 3 * * 1`** = **09:00 IST Monday** assuming a **UTC** container
  (03:30 UTC). If the deployed container runs in IST, edit the flow to
  `0 9 * * 1`. Confirm with `date` on the host before flipping to `active`.
- Period defaults to **`last_7_days`** → a Monday run reports the trailing
  week, compared (deltas) against the equal-length window immediately before
  it (abutting, computed in S1 `resolvePeriodRange`).
- Seeded as **`draft`**. Flip to `active` only after the S1/S2/S3 stack is
  live and the email template + env are in place (see Ops tail).

## Thresholds (suggestion rules)

Defaults live in `DEFAULT_DIGEST_THRESHOLDS`
(`apps/backend/src/workflows/analytics/partner-digest-lib.ts`).
`buildDigestSuggestions` emits 6 thresholded rules; the referrer / page /
mobile rules are **sample-gated at ≥ 20 visitors** so low-traffic partners
don't get noisy advice.

To override per-run, add a `thresholds` partial to the `compute_digests` op
options in the seed (merged onto defaults), e.g.:

```ts
options: { period: "last_7_days", thresholds: { bounce_rate_high: 0.7 } }
```

To add/adjust a rule: edit `buildDigestSuggestions` + the corresponding key
in `DigestThresholds` / `DEFAULT_DIGEST_THRESHOLDS` + a unit test in
`partner-digest-lib`.

## Ops tail (prod — daemon cannot author)

Before activating the flow:

1. **Merge + deploy** the #581 stack (#582 → #583/#584). The op type
   `partner_analytics_digest` and workflow `send-partner-digest-email` must
   exist in the registry, else the run no-ops / errors.
2. Author an **active `partner-storefront-digest` `email_template` row**
   consuming the S2 template data: `kpi_rows`, the breakdown arrays
   (`{{#each}}`), `suggestions`, `period_start` / `period_end`,
   `dashboard_url`.
3. Set env: `MAILEROO_FROM_DOMAIN`, `PARTNER_DASHBOARD_URL`, `FRONTEND_URL`.
4. Flip flow `draft → active` in the admin editor.

## Verification

- Pure logic only is headless-verifiable; email + live flow execution are not.
- S1: `TEST_TYPE=unit … jest --testPathPattern=partner-digest-lib` (29)
- S2: `… --testPathPattern=partner-digest-email-lib` (15)
- S3: `… --testPathPattern=partner-analytics-digest` (16)
- S4: `… --testPathPattern=seed-partner-analytics-digest-flow` (7 structural —
  pin the op/workflow string refs + the linear graph since the seed is
  editor-gated and can't be live-verified).

## #589 enhancements

### 1. Recipient filter (live-storefront only) — DONE

The first weekly fan-out mailed partners with **no store at all**. Fixed in
`modules/visual_flows/operations/partner-analytics-digest.ts`: after computing
each partner's digest, `partitionEligibleDigests` keeps only the
storefront-eligible ones (`isPartnerDigestEligible` ⇒ truthy `website.id`) in
the `digests[]` / `records` fan-out output, so `bulk_trigger_workflow` →
`send-partner-digest-email` never mails a no-store partner. The op output gains
`computed` (total digests computed) and `excluded` (no-store partners dropped)
alongside the existing counts.

A **has-store partner with zero traffic stays eligible** — they get the
zero-data "start sharing" nudge (item 2, separate slice), not exclusion.
Pure + unit-tested (`isPartnerDigestEligible`, `partitionEligibleDigests`;
S3 spec now 22).

### 2. Zero-data "start sharing" nudge — DONE (PR #591)

Pure `digestHasData(digest)` + `has_data` flag in `partner-digest-email-lib.ts`;
the seed template wraps stats in `{{#if has_data}}` and adds a
`{{#unless has_data}}` share-your-store nudge for has-store / zero-traffic
partners.

### 3. AI summary — data contract DONE (stacked on #591), live wiring deferred

A natural-language recap of the week, authored by an `ai-extract` node, surfaced
as an executive-summary callout above the KPI table.

**This slice (verifiable, pure):**
- `PartnerStorefrontDigest.ai_summary?: string | null` (rides on the digest so it
  survives the `bulk_trigger_workflow → send-partner-digest-email` hand-off,
  which passes `{ digest: "{{ item }}" }` — there is no per-item enrichment slot
  between the op and the email otherwise).
- Pure `sanitizeAiSummary(raw)` in `partner-digest-email-lib.ts` (collapses
  control chars + whitespace to a single paragraph, hard-caps at
  `AI_SUMMARY_MAX_LEN = 600` on a word boundary with an ellipsis; `""` for
  non-strings/blanks). Handlebars HTML-escapes on render, so it's a length/shape
  normaliser, NOT an HTML sanitiser.
- `buildPartnerDigestTemplateData` exposes `ai_summary` + `has_ai_summary`.
- Seed template gains a `{{#if ai_summary}}` callout (blue executive-summary box)
  inside the `{{#if has_data}}` branch, above the KPI table.
- +7 unit (email-lib spec 19 → 26). Optional + absent by default ⇒ the email is
  unchanged until the flow populates `digest.ai_summary`.

**Deferred (live wiring — daemon can't run the flow / model):** the slice does
NOT yet populate `ai_summary`. Two placement options for a follow-up:
1. **Inside the `partner_analytics_digest` op** — after computing each digest,
   run an `ai-extract` over the digest's KPIs/breakdowns and set
   `digest.ai_summary` before `partitionEligibleDigests`. Keeps the email
   workflow untouched; one model call per eligible partner; must stay
   best-effort (never abort the run).
2. **An `ai-extract` node inside `send-partner-digest-email`** (per-partner in the
   fan-out). Cleaner separation but adds a node to the email workflow.
   Prefer option 1 — it keeps AI enrichment in the data layer the op already owns.

**Ops tail (prod):** the live `partner-storefront-digest` email_template was
authored via admin API and is NOT re-seeded on deploy — after merging, apply the
same `{{#if ai_summary}}` html edit to the live template via the admin API (same
manual pattern as the `has_data` branch).
