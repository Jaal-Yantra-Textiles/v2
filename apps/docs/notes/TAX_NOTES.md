# Tax notes — partner-side configuration realities

> Captured 2026-06-05 during roadmap item 5 verification (PR #316 +
> follow-up). Living doc: when a new country's tax behaviour surprises
> us, add a section here.

## How partner cart-tax actually works

1. Admin seeds a canonical `tax_region` per country with a
   `default_tax_rate` (script: `seed-canonical-tax-regions.ts`).
2. Each partner has regions covering some set of countries
   (partner_region link).
3. At cart time, Medusa's TaxModule matches the cart's shipping
   address country against `tax_region.country_code`, picks the
   matching rate (default or rule-matched), and writes
   `cart.tax_total`.

No per-partner tax_region copies; the canonical row is shared. If
the canonical rate is wrong for a partner's catalog, the partner has
to either (a) override the rate on the canonical region directly via
the tax-regions admin UI, or (b) add per-product / per-product_type
rules.

## What Medusa's `tax_rate_rules` can and can't express

`TaxRateRule.reference` only accepts:

- `"product"` — matches a specific product by `reference_id = prod_*`
- `"product_type"` — matches a product_type by
  `reference_id = ptyp_*`

It **cannot** condition on `unit_price`, `cart.total`, customer group,
shipping zone subdivision, or any other line-level numeric attribute.
Source: `@medusajs/types/dist/tax/service.d.ts` example at lines
160-184 of the package shipped with Medusa 2.15.3.

This matters for any country whose statutory tax depends on a price
threshold rather than the category alone.

## India — two-tier apparel/textile GST (effective 22 Sept 2025)

CBIC Notification No. 9/2025-Central Tax (Rate) reformed apparel
GST:

- Apparel and clothing accessories **≤ ₹2,500 per piece**: **5% GST**
- Apparel and clothing accessories **> ₹2,500 per piece**: **18% GST**

Material (handloom, cotton, silk, synthetic) doesn't change the rate
— only the sale-price-per-piece does. The reform replaced the older
5%/12% split at ₹1,000.

### What our canonical seed says

`seed-canonical-tax-regions.ts` lists India as `18%`. This is correct
for the **upper band only**. Applying it as a flat rate would
over-charge sub-₹2,500 SKUs.

### What we actually see in prod

Sharlho's `tax_region` for IN is set to `5% (code=GST,
is_default=true)`. Verified 2026-06-05 by curling the prod store API
with their publishable key, creating a cart for an AU and IN shipping
address against a ₹4,999 variant — the cart returned
`tax_total = 5%`. So:

- Sub-₹2,500 SKUs: correctly charged at 5% ✓
- Above-₹2,500 SKUs: **under-charged** at 5% (should be 18%) — partner
  collects ₹100 less per ₹770 in price than they owe at filing.

### Why we don't fix this in canonical seed

The seed creates ONE `default_tax_rate` per country. A single flat
value is wrong for India regardless of whether it's 5% or 18%. The
fix has to be at the partner level via either:

1. **Per-product_type rules** — partner tags variants with a JYT-
   provided `tax_class` product_type
   (`textile_under_2500` / `textile_over_2500`), then creates a
   second tax_rate on the IN tax_region scoped to the over-2500
   class. Burden: every time a SKU crosses the threshold the tag has
   to be updated.
2. **Per-product rules** — explicit `rules: [{reference: "product",
   reference_id: prod_*}]` for each above-₹2,500 SKU. Manual upkeep
   per SKU; OK for catalogs of a few dozen, painful at hundreds.
3. **Custom TaxProvider** — replace `tp_system` with a JYT provider
   that knows about price bands natively. Heaviest lift but the
   right shape long-term; not on the roadmap yet.

### Audit script behaviour

`scripts/audit-tax-coverage.ts` flags partners whose regions cover
India with a `review_needed` note so future audits surface the
exposure without a manual reminder. It does **not** automate the
fix — that's a partner-config decision.

## When to add a new section here

- A country we onboard has a price-band, customer-class, or
  product-category-conditional rate that a single canonical default
  can't capture.
- A statutory change shifts the rate or band (re-run
  `seed-canonical-tax-regions.ts` is fine for simple flat-rate
  changes; complex shifts go here first).
- A partner reports tax under/over-collection — record the case
  before reacting so the next audit can flag the same shape on
  other partners.
