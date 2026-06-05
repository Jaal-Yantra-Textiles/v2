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

### Why we don't fix this in the canonical seed

The seed creates ONE `default_tax_rate` per country. A single flat
value is wrong for India regardless of whether it's 5% or 18%. The
fix has to be a **non-default rate scoped to a product_type** — what
Medusa's docs and the partner-ui call a "tax override".

### Shipped approach (PR #TBD): JYT-managed product_type +
### auto-classifier

A second seed script + a price-event subscriber automates the
classification end-to-end:

1. **`scripts/seed-in-textile-tax-class.ts`** — idempotent. Creates
   one JYT-managed `product_type` with value
   `jyt_tax_in_textile_over_2500`, ensures the IN `tax_region` has
   the default 5% rate, and adds a non-default 18% `tax_rate` with
   `rules: [{reference: "product_type", reference_id: <ptyp_id>}]`.
2. **`workflows/tax/classify-product-tax-class.ts`** — given a
   `product_id`, resolves the max INR variant price and assigns or
   clears the JYT-managed type. Refuses to overwrite a
   partner-managed `type_id` (anything that isn't one of the values
   in `JYT_MANAGED_TAX_CLASS_VALUES`).
3. **`subscribers/classify-product-tax-class.ts`** — listens on
   `product.created` and `product.updated`, runs the workflow.
4. **`scripts/backfill-classify-products-tax-class.ts`** — one-shot
   for the historical catalogue. `--partner-ids=` scoped, `--dry-run`
   aware. Re-runnable.

The conservative tradeoff: a product carries **one** `type_id`. If
variants A (₹1,500) and B (₹3,000) sit on the same product, the
product gets `jyt_tax_in_textile_over_2500` (max-price strategy).
Variant A then over-collects at 18% rather than the statutory 5%.
Over-collecting beats under-collecting on the tax-liability side, but
it's worth telling partners with mixed-price products to split them
into separate listings.

### Partner-side UI already supports this

`apps/partner-ui/src/routes/tax-regions/tax-region-tax-override-create/`
exposes a form bound to `POST /partners/tax-rates` (active
references: `product`, `product_type`, `shipping_option`). Partners
can see and manage the JYT-created override row alongside any custom
overrides of their own — they don't need a separate admin tool.

### Audit script behaviour

`scripts/audit-tax-coverage.ts` flags partners whose regions cover
India with a `review_needed` note so future audits surface the
exposure without a manual reminder. The classifier handles the rest
automatically.

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
