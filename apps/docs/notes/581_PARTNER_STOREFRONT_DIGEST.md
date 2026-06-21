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
