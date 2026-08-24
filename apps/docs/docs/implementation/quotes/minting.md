---
title: "Minting a quote: the one workflow, and a live blocker"
sidebar_label: "Minting"
sidebar_position: 3
---

# Minting a quote

**Code:** `apps/backend/src/workflows/partner-quote/mint-quote.ts`,
`src/api/admin/quotes/route.ts`, `src/api/partners/quotes/route.ts`

## One workflow, two surfaces

Both `POST /admin/quotes` and `POST /partners/quotes` run
`mintQuoteWorkflow`. A second inline implementation would drift from the one
that freezes prices, creates the customer group, and **asserts the price-list
rule from a re-read** — that assertion is the only thing standing between a
quote and a platform-wide price cut.

The admin body extends the partner **shape** and re-applies
`dutyUndertakingRefinement`. `.extend` on an already-refined schema silently
drops cross-field rules, and the rule it would drop is the one stopping a DDP
quote from promising duty cover with no amount behind it ([#1447]).

The only difference between the surfaces is `partner_id`: required to mint,
optional to list. An admin mint is stamped `actor_type: "admin"` — the first
question asked when a buyer challenges a price is who quoted it.

## The raw token is returned once

Only its sha256 is persisted. An admin list can therefore never show a working
link for an existing quote and must not pretend to — the only way to get a fresh
link is to mint again.

## 🔴 Live blocker: an existing buyer cannot be quoted ([#1507])

Minting to an email that already exists as a customer **anywhere on the
platform** answers 400:

```
Customer with email: <addr>, has_account: false, already exists.
```

`resolve-quote-buyer-step` looks the buyer up **scoped to the store** — correct,
because another partner's customer with the same email is not this partner's
buyer — but `customer.email` is **globally unique** in core. The two rules are
unsatisfiable together: the lookup cannot see the row, and the create collides
with it.

It bites exactly the highest-value case: an existing customer of one store
asking a partner for a bulk price. Both mint surfaces are affected. The
workaround used on 24 Aug was a `+tag` alias, which is not a fix — it mints a
quote to an identity that is not the buyer's.

:::note The compensation is sound
The failed mint left no orphan: compensation deletes only what the run created
and never the customer.
:::

## ⚠️ Other watch-outs

- **`zodValidator` forces `.strict()`.** A field the schema does not name never
  reaches the workflow — the deal silently takes default terms while the wizard
  shows the number the partner typed. `deposit_pct` is the cautionary example.
- **`freight_override_amount` is `.positive()`, not `.min(0)`.** A zero would be
  free international shipping typed by accident, and this system has shipped
  bulk orders free once already from a rule-gated `0 INR` row ([#1430]).
- **Revoking is not a status flip.** The quote's prices live in a real, active
  price list scoped to the buyer's customer group. `POST /admin/quotes/:id/revoke`
  deletes the price list **first** and marks the row second: a failure then
  leaves a visibly inconsistent but safe state, where the reverse order would
  leave a revoked-looking quote still quietly pricing carts. It is idempotent.
- **A repeat quote stacks price lists** ([#1435], unfixed). Two active lists on
  one customer group means core tie-breaks to the **cheapest**, so a re-quote at
  a higher price can hand the buyer the old one.
- **Buyer tax id changes no number.** Quote tax follows the *seller's*
  jurisdiction ([#1447]); the buyer's registration is a line on a document.

[#1430]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1430
[#1435]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1435
[#1447]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1447
[#1507]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1507
