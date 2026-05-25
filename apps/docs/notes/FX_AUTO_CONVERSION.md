# FX Auto-Conversion + Storefront "We Don't Ship Here" Fixture

> Status: **DRAFT** — design doc before code. Review and mark up.
> Date: 2026-05-25
> Owner: Saransh
> Companion to `SAAS_TIERS.md` and `PARTNER_API_PARITY.md`.

## Goal

Partners set one price per product variant in their native currency (typically INR). The system fans that price out to every other currency the partner's store supports, using current FX rates. Customers in any region see prices in their local currency, no manual partner intervention per region. Daily re-rate keeps prices roughly aligned with current FX. The storefront degrades gracefully when a region or price isn't available.

This unlocks fast partner onboarding (one price, not N), and matches the "Shopify Markets" model partners expect.

## Architecture — visual-flow-trigger + TS-workflow-logic hybrid

Two pieces work together:

1. **TS workflows + new `fx_rates` module** carry the complex logic (FX provider fetch, cross-rate math, price fanout, re-rate). Tested via Jest integration tests like the rest of the partner-region work.
2. **Visual flow seeds** wrap each workflow with a schedule trigger. Admin sees the flow in the visual editor, can pause/edit/reschedule without code changes. The flow's only operation is `trigger_workflow` → custom TS workflow.

Best of both: the heavy lifting is in code (typed, tested), the schedule + admin visibility comes from the visual flow infra that already exists in this codebase (`apps/backend/src/modules/visual_flows/`, `apps/backend/src/jobs/run-scheduled-visual-flows.ts`).

## Data model — new `fx_rates` module

```
fx_rates
  id              ULID
  base_currency   text  ("usd" — canonical base from provider)
  quote_currency  text  ("inr", "eur", "gbp", ...)
  rate            numeric(20, 10)  (1 base = rate quote)
  fetched_at      timestamptz
  source          text  ("open.er-api.com" | "manual" | other future providers)
  metadata        jsonb
  PRIMARY KEY (base_currency, quote_currency)  — one rate per pair
```

Service surface:
- `getRate(from: string, to: string): Promise<number>` — looks up via base, computes cross-rate if needed (e.g., `inr→eur = usd→eur / usd→inr`)
- `getAllRates(): Promise<FxRate[]>`
- `setRates(rates: FxRateInput[]): Promise<void>` — upserts
- `getLastFetchedAt(): Promise<Date | null>` — stale-check helper

Module exposed via `query.graph` for partner UI / admin diagnostic reads. Partner doesn't write to it.

## Daily re-rate, NOT read-time refresh

**Why:** cart consistency. Read-time refresh creates the "customer added at EUR 11.20, checkout charges EUR 11.26" failure. Daily re-rate caps drift at ~24h, which is invisible at our currency mix (INR/EUR/USD/AUD all stable, daily moves <0.5% typical). Stripe/PayU expect a fixed amount; Medusa's cart snapshots line-item prices at add-time — both work cleanly with stable daily prices.

Re-rate flow:
1. Daily visual flow fires at 02:00 UTC
2. Triggers `refresh-fx-rates` workflow → fetches from open.er-api.com, writes to `fx_rates` module
3. Triggers `rerate-auto-converted-prices` workflow → finds all `price.metadata.is_auto_converted = true`, updates `amount` to `base_amount × fresh_rate`

Manual partner overrides (`metadata.is_auto_converted` not set or false) are never touched.

## FX provider: open.er-api.com for v1

| Provider | Why | Why not |
|---|---|---|
| **open.er-api.com** ✓ | Free forever, no key, no signup. USD-based. Daily refresh sufficient for our domain. | Slight rounding error on non-USD pairs (computed via USD intermediate). Acceptable. |
| `exchangerate.host` | Free with signup | Recent plan changes; risk of similar future changes |
| `openexchangerates.org` | Hourly rates, reliable | $12/mo; overkill until we have FX-sensitive customers |

Service interface keeps provider behind a swap-able adapter — promote to paid provider later without changing the rest of the system.

## Lazy fanout at write time, not aggressive at variant create

Subscriber listens to variant price events. Fanout fires only when a real price is set. Variants without prices stay clean (no zero-priced phantom rows polluting the pricing grid).

Fanout algorithm:
1. Partner sets price `INR 1000` on variant X
2. Subscriber fires `fanout-prices-on-variant-price-set` workflow
3. Workflow reads `variant.product.sales_channels[0].store` → store.supported_currencies
4. For each currency in supported_currencies that the variant DOESN'T already have a price for:
   - `convertedAmount = fxRatesService.getRate("inr", targetCurrency) × 1000`
   - Create a price row with `currency_code: targetCurrency`, `amount: convertedAmount`, `metadata.is_auto_converted: true`, `metadata.base_currency: "inr"`, `metadata.base_amount: 1000`
5. Existing prices (manual or previously auto-converted) are left alone unless re-rate is running

The `base_currency` + `base_amount` on each auto price lets re-rate recompute from the source (handles the case where partner changes base price → all derived prices update together).

## Partner UI

In the pricing grid (`apps/partner-ui/src/routes/.../*-pricing-form.tsx`):

- Cells where the underlying price has `metadata.is_auto_converted = true` render with a small 🔄 badge + lighter background
- Hover tooltip: "Auto-converted from INR 1000 at 0.012 USD/INR (refreshed 2 hours ago)"
- Click on cell value → editable; on save, strips `is_auto_converted` flag (becomes a manual override that never gets re-rated)
- Store-level setting (settings/store): "Auto-convert prices across regions" toggle. Default ON. OFF means subscriber doesn't fan out for new prices on this store.

No changes to the cart, checkout, or storefront pricing flow — those already use Medusa's calculated_price + line-item snapshot.

## Storefront fixture — "we don't ship here yet"

Two scenarios in `apps/storefront-starter/`:

1. **No region for customer's country** — `getRegion("zw")` returns null because partner has no Zimbabwe region linked
2. **Region exists but variant has no price in the region's currency** — partner forgot to set up a base price; auto-fanout didn't fire

Both render the same `<RegionNotServedFallback />` component:

- Friendly header: "We don't currently ship to {country}"
- Sub: "But we'd love to hear from you. Drop us a line and we'll let you know when we expand."
- Contact form (name, email, optional message) → POSTs to `/store/contact-region-request` → forwards to partner via existing partner notification system
- Renders inside the product detail layout so product images/description still show; only the price + add-to-cart are replaced

`/store/contact-region-request` is a new partner-scoped storefront endpoint that's hit via the storefront's publishable key → partner lookup.

## Build order (5 PRs, each independently shippable)

| PR | Scope | Effort | Independently useful? |
|---|---|---|---|
| **G1** | `fx_rates` module + open.er-api.com fetcher service + one-shot `seed-initial-fx-rates.ts` script | ~half day | Yes — gives partner UI / admin a place to read rates, diagnostic tooling |
| **G2** | `refresh-fx-rates` workflow + daily visual flow seed | ~half day | Yes — rates stay fresh even before fanout exists |
| **G3** | `fanout-prices-on-variant-price-set` subscriber + workflow | ~1 day | Yes — once partners set base prices, fanout works automatically |
| **G4** | Partner UI: pricing-grid badges + manual override + store settings toggle | ~half day | Yes — partners can see + control auto-conversion |
| **G5** | `rerate-auto-converted-prices` workflow + daily visual flow seed | ~half day | Yes — closes the loop on drift |
| **H** | Storefront `<RegionNotServedFallback />` + `/store/contact-region-request` endpoint | ~half day | Yes — independent UX improvement, doesn't depend on FX work |

**Total:** ~3.5 days for the full set across 6 PRs. Roughly a week with review cycles.

## Testing strategy per PR

- **G1:** integration test — mock the open.er-api.com fetch, assert rates are written, assert `getRate()` returns expected cross-rate
- **G2:** integration test — verify the visual flow seed is idempotent, verify the workflow refreshes rates and bumps `fetched_at`
- **G3:** integration test — set price on variant, assert fanout creates N other prices with `is_auto_converted: true`, assert lazy behavior (no fanout for variants without manual prices)
- **G4:** Playwright e2e on partner UI — verify badge renders, click promotes to manual, settings toggle disables fanout
- **G5:** integration test — set manual + auto prices, run re-rate, assert auto prices updated, manual prices untouched
- **H:** Playwright e2e on storefront-starter — visit storefront with country=zw header, assert fallback component renders, submit contact form, assert POST succeeds

## Out of scope (deferred)

- **Hourly re-rate** — would need an hourly visual flow, fine to add later if 24h drift becomes a complaint
- **Paid FX provider** — swap-out is a one-line interface change; defer until we have FX-sensitive partners
- **Per-product base currency override** — every variant uses store's default currency as base; deferred until partners need it
- **Manual rate override per partner** — partner can't say "treat INR→EUR as 0.013 for my store" yet; deferred until anyone asks
- **Re-fanout on FX rate change** — if rates move > X%, optionally re-create prices instead of just re-rating. Not v1.
- **Currency formatting per locale** — already handled by Medusa storefront; verify but don't change

## One open question for you

Where does the `base_currency` for a partner's store live? Options:
- **A.** `store.supported_currencies.find(c => c.is_default).currency_code` — already on the data model, no schema change
- **B.** `store.default_region_id` → region.currency_code — uses the partner's "primary" region's currency
- **C.** New explicit `store.metadata.base_currency` field — explicit, less coupling

I lean toward **A** because it's already there, partner controls it via the store settings UI, and it's the canonical "this is the partner's currency" signal in Medusa. (B) drifts when partner changes default region. (C) duplicates state.

Lock this before I start G3 (the fanout subscriber).
