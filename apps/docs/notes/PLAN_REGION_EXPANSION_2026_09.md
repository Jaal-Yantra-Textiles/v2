# Opening new sales territories (2026-09-11)

Founder's call: **plain Stripe (`pp_stripe_stripe`) for all payments from abroad.**
`pp_stripe-connect_stripe-connect` is the PARTNER payout configuration and is not
a checkout rail — do not wire it to a buyer-facing region.

## Why this is worth doing

The store supports **11 currencies**. Only **6** have a region:

```
aud, eur, idr, ils, inr, usd   ← sellable
aed, cad, chf, cny, gbp        ← 🔴 priced on every variant, buyable by NOBODY
```

The FX fanout has been minting GBP/CAD/AED/CNY/CHF prices for months against
regions that do not exist. **Creating the region is what turns a price that
already exists into revenue** — no FX work needed for those five.

Switzerland is the sharpest case: we shipped there on 2026-09-10, a CHF price
exists on every variant, and `ch` sits inside the EUR region, so that price is
dead.

South America and Africa need no new currency either — **USD prices already
exist on everything**.

## The change set

### Create (7 regions, all `payment_providers: ["pp_stripe_stripe"]`)

| name | currency | countries |
|---|---|---|
| United Kingdom | `gbp` | `gb` |
| Canada | `cad` | `ca` |
| United Arab Emirates | `aed` | `ae` |
| China | `cny` | `cn` |
| Switzerland | `chf` | `ch` ← moved out of Europe |
| South America | `usd` | 12: ar bo br cl co ec gy py pe sr uy ve |
| Africa | `usd` | 54 (full continent) |

### Update (1 region)

**Europe** — remove `ch`, leaving **31** countries.

🔴 `update_region.countries` REPLACES the list wholesale. Send all 31 or the
omitted ones silently resolve to no region at all:

```
al ad at be bg hr cy cz dk ee fi fr de gr hu it lv li lt lu
mt nl no pl pt ro rs sk si es se
```

The exact payloads are in `/tmp/regions/plan.json` in the session that wrote
this; regenerate from the table above if that is gone.

**Coverage: 38 → 108 countries.** No country appears in two regions (checked).

## ⚠️ A region is not sellable just because it exists

Three things, and only the first is done by `create_region`:

1. **Currency + countries** — this plan.
2. **Payment provider** — `pp_stripe_stripe`, passed at create time. Region-enabled
   is NOT container-registered; naming a provider the container cannot resolve
   gives a buyer a checkout with nothing to pay with.
3. 🔴 **A shipping option that reaches it** — NOT covered here. Without it a buyer
   browses, adds to cart, and fails at the last step. Same shape as #1982's
   unfulfillable products. **Verify carrier coverage for Lagos / São Paulo
   before announcing anything.**

## 🔑 Partner propagation is ALREADY AUTOMATIC — do not build it

Checked before writing anything, and the plumbing exists:

`subscribers/region-propagate.ts` listens on **`region.created`** and runs
`workflows/regions/propagate-region-to-partners.ts`, which for every active
partner:

1. creates the `partner_region` link, and
2. extends that partner store's `supported_currencies` with the region's
   currency.

So creating the 7 regions **automatically** maps them to all 12 partner tenants.
There is also `POST /admin/regions/:id/share-to-all` for a manual re-run.

⚠️ **But the partner price fanout is env-gated and OFF.** The subscriber only
fans out when `REGION_PROPAGATE_FANOUT=1`, and that variable is **not in SSM**,
so it is unset on prod. Partners therefore get the link and the currency but
**no prices** until either their next variant save or an explicit replay.

### The two data-ops jobs to run afterwards — both already exist on prod

| job | what it does |
|---|---|
| `repair-partner-region-links` | adds a missing link where a store's `default_region_id` points at an unlinked region, removes orphan links whose region was deleted. Params: `partner_id`, `limit`. Pure link-table ops, no entity writes. |
| `replay-fx-fanout` | materialises the converted price rows. Params: `partner_id`, `limit`, `include_house_stores`. |

🔴 `repair-partner-region-links` repairs links against `default_region_id`; it
does NOT propagate a NEW region to everyone. The subscriber does that. Run the
job to VERIFY and repair, not as the propagation mechanism.

## Order of operations

1. Merge + deploy `create_region` / `update_region` / `list_payment_providers`
   (PR #1994, merged `f4a9c7b24`).
2. ⚠️ **MCP tool lists load at SESSION START.** A session open before that deploy
   cannot call the new tools however healthy prod is — start a fresh session.
3. `list_payment_providers` → confirm `pp_stripe_stripe` resolves on prod.
   Do not assume the id.
4. Create the 7 regions. **Switzerland LAST**, after the Europe update, so `ch`
   is never briefly in two regions.
5. Update Europe to the 31.
6. **Partner propagation happens on its own** via the `region.created`
   subscriber — watch the logs rather than doing anything.
7. Data ops: `repair-partner-region-links` (preview → apply) to verify every
   partner is linked.
8. Data ops: `replay-fx-fanout` with `include_house_stores` to materialise the
   converted prices, since `REGION_PROPAGATE_FANOUT` is unset.
9. Verify: `list_regions` shows 13, and every store currency has a region.
10. Then the shipping question (3 above).

## Related

- #1979 — the currency work this came out of
- #1993 — cold-storefront middleware 500; an uncovered country is *silently
  defaulted* today rather than refused, which is the other half of this
- #1982 — products born unfulfillable, the same "exists but cannot be sold" shape
