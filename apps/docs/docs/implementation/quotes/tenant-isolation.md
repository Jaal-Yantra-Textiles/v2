---
title: "Quote tenant isolation: the guard fails closed"
sidebar_label: "Tenant isolation"
sidebar_position: 1
---

# Quote tenant isolation

**Issues:** [#1496] (the leak), [#1439] · **Shipped:** #1499
**Code:** `apps/backend/src/api/store/b2b/quotes/[token]/route.ts`

## The leak

A buyer quote page rendered on **every** partner storefront. Three different
stores' publishable keys all returned 200 for the same token. There was no
tenant check at all: the token was the only thing consulted, and a token is not
a tenancy.

## Why the first fix was still open

S15 added a guard that refused only a **proven** mismatch. Where either side was
unresolvable — quote without a `store_id`, key resolving to no store, store with
no sales channel — it allowed the read and logged.

That was deliberate. Failing closed on *"cannot tell"* is the [#1397] outcome:
a dangling publishable key produced `sales_channels: [null]` on an unfiltered
cross-tenant query and every partner storefront 500'd. A certain loss traded
against a possible leak.

**The sizing was wrong, and it was wrong because it came off a dev database.**
24 of 28 stores looked channel-less and 12 of 16 quotes looked untagged; after
filtering `E2E %` rows it was 0 of 2.

## What prod actually said (24 Aug 2026)

| measure | prod |
|---|---|
| `partner_quote` rows carrying `store_id` | **8 of 8** — nothing to backfill |
| stores lacking `default_sales_channel_id` | **0 of 13** |
| publishable keys resolving to a store | **14 of 14** |

Nothing relied on any of the three hatches, so each is now a refusal.

## The shape of the refusal

**404**, with the same body an unknown token gets. A prober must not learn a
token is real by being told they are on the wrong shop. A revoked quote is
deliberately indistinguishable from an unknown one for the same reason.

The *keyless* case never reaches this code — core rejects a missing
`x-publishable-api-key` with a 400 before the route runs. So the "no sales
channels" hatch could only ever have been the dangling key of #1397.

## Verified on prod (24 Aug 2026)

Live quote `01M0S1TMHCJ72FJ7766ZGAVMKB` on the Unique Pashmina storefront:

| key | result |
|---|---|
| Unique Pashmina publishable key | **200** |
| JYT Medu Store publishable key (same token) | **404** |

## ⚠️ Watch-outs

- **A store created without a default sales channel now locks its own buyers
  out** rather than falling through. That is the intended trade — but it is why
  both the guard's docblock and the `backfill-quote-tenancy` job report those
  counts. Re-run the job before assuming the numbers still hold.
- **The callee must refuse.** Passing the right id from the caller is not the
  fix on its own; the same shape produced [#1433], where a missing filter meant
  *no filter* rather than *no rows* and a public quote page priced freight from
  every tenant's locations. Fix both ends.
- **The two new tests were confirmed to fail against the old guard** before
  being accepted. That check is the point — #1495 was a suite passing 7/7 over
  an assertion its own fixture had made vacuous.

[#1397]: https://github.com/Jaal-Yantra-Textiles/v2/pull/1397
[#1433]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1433
[#1439]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1439
[#1496]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1496
