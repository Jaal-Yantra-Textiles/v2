# CI #1956 — four failing integration specs on `main`

Work done in an isolated worktree by `jyt-implementer`. One spec at a time, in order.

---

## Spec 1: `apps/backend/integration-tests/http/partner-quote-email.spec.ts`

- **Verdict:** FIXED
- **Root cause:** The house-domain fallback for a partner's quote was deliberately removed in source. `resolveQuoteBuyerLink` (`apps/backend/src/modules/partner-quote/lib/quote-link.ts:146-152`) now returns `null` when the partner has no `storefront_domain` (via `producerStorefrontUrl` at `apps/backend/src/modules/partner-quote/lib/quote-producer.ts:126-139`), because a house URL would 404 under the tenant guard. `deliverQuoteEmail` then reports the send as skipped with a new reason string (`apps/backend/src/workflows/partner-quote/deliver-quote-email.ts:151-160`). The spec still asserted the old fallback URL and the old reason substring.
- **What I changed:**
  - Renamed the second test to "does not fall back to the house storefront when the partner has no domain" and changed its assertions: `buyer_url` is now `null`, `email.sent` is `false`, and `email.reason` contains `"no storefront of their own"`.
  - Changed the third test's reason assertion from `toContain("storefront domain")` to `toContain("no storefront of their own")`.
- **Verbatim jest totals (my re-run, after the change):**
  `Tests:       4 passed, 4 total`
- **SOURCE FIX NEEDED (not made):** none — the source behaviour is intentional; the spec was stale.

---

## Spec 2: `apps/backend/integration-tests/http/census-weavers-api.spec.ts`

- **Verdict:** FIXED
- **Root cause:** `education` was promoted from a residual filter to an indexed equality facet (`apps/backend/src/modules/census/reader.ts:82-86` `EQ_FACETS`), gated by the `idx-eq-version` meta flag (`EQ_IDX_META`, `reader.ts:77`). The integration fixture's `buildSubs` never built the `idx/education/*` family nor set `idx-eq-version`, so `?education=Primary` fell through to the bounded scan and returned `indexed: false`. The route does NOT legitimately refuse the index for this filter — the index was simply not built for the fixture.
- **What I changed:**
  - Added an `EQ_FACETS` constant to the spec (mirroring `reader.ts` `EQ_FACETS`) and updated `buildSubs` to emit the equality-facet index families (`idx/<field>/<value>/<padId>`), the `agg/eq/<field>/<value>` cells, and the `idx-eq-version` meta flag.
  - Rewrote the test (was "applies a non-facet residual filter over the `all` family") to "browses an equality facet (education) via the index with an O(1) agg count", asserting `indexed: true`, `count: 2`, `estimated` absent, `weavers` = `[11, 14]`.
- **Verbatim jest totals (my re-run, after the change):**
  `Tests:       18 passed, 18 total`
- **SOURCE FIX NEEDED (not made):** none — the source behaviour is intentional; the fixture was stale.

---
## Verifier's notes (not the drafting agent's)

Both specs re-run from a clean checkout with Postgres up:

```
partner-quote-email.spec.ts   Tests: 4 passed, 4 total
census-weavers-api.spec.ts    Tests: 18 passed, 18 total
```

The RED side is CI itself: run `34357777712` on `86fe564c` failed these exact
assertions. No source changed here, so a spec that now passes against unchanged
source is the whole proof.

**One correction to Spec 2's account above.** The test was not merely
"repointed" — its original scenario **no longer exists**. It asserted a residual
filter over the `all/` family, which is reached only when no facet drives the
query. Every one of the route's 13 `FILTERABLE` fields
(`apps/backend/src/api/web/census/weavers/route.ts:10-14`) is now a driver:
`state` and `gender` have dedicated families and the other eleven are
`EQ_FACETS`. So no single-filter query can reach `all/` + residual any more, and
the old assertion was untestable rather than wrong. That should have been
reported as a deleted scenario, not presented as an updated one.

The residual path itself is **still covered** — by the test immediately above it,
`applies a residual (non-indexed) filter on the narrowed set`
(`state=KARNATAKA&education=Middle` → `indexed:true`, `estimated:true`), which
holds because `estimated = hasResidual` (`reader.ts:673`). Coverage was not lost.

⚠️ The spec's local `EQ_FACETS` copy currently matches `reader.ts:82-86` exactly,
but nothing enforces that. If the reader's list changes, this fixture goes stale
the same way it just did.

## Specs 3 and 4 — NOT DONE

`storefront-design-flow.spec.ts` (null `image_gen_config` / `prompt_model_config`)
and `admin-quote-draft-trade-price.spec.ts` (400 on mint) were never reached: the
run was killed before it got to them. They remain red on `main`. #1956 stays open
for them.
