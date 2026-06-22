# #649 — Global shipping-provider abstraction (admin / stores / partners)

**Analysis-first pass** (per #649's own request). Grounded against the live code on
`origin/main` 2026-06-22. Every claim cites `path:symbol`. **No code in this slice** —
this is the PR-by-PR plan + the product decisions that gate it.

Related prior docs (do **not** duplicate — this one is the *cross-surface promotion* plan):
- `apps/docs/notes/SHIPPING_PROVIDERS.md` — #31 spike: the interface, resolver, pickup registration.
- `apps/docs/notes/404_SHIPPING_PROVIDERS_ANALYSIS.md` — registry/interface/admin-route inventory.
- `apps/docs/notes/639_PARTNER_SHIPROCKET_PARITY.md` — partner label/attach-AWB routes (#639).

---

## TL;DR — the abstraction mostly EXISTS; the gap is *config scoping + surfacing*

#649's "Current state" framing undersells what already shipped. Reality on main:

1. **Normalized carrier interface — DONE.** `ShippingProviderClient` in
   `src/modules/shipping-providers/provider-interface.ts` (getRates / createShipment /
   getLabel / track / cancelShipment / schedulePickup / registerPickupLocation /
   listPickupLocations / normalizeWebhook).
2. **Carrier-keyed resolver — DONE.** `resolveShippingProvider(container, carrier)` in
   `src/modules/shipping-providers/resolver.ts`; `SUPPORTED_CARRIERS = ["delhivery","shiprocket"]`.
3. **Adapter fleet — bigger than #649 says.** SIX provider service dirs exist and are all
   exported from `src/modules/shipping-providers/index.ts` via
   `ModuleProvider(Modules.FULFILLMENT, { services: [...] })`: `delhivery`, `shiprocket`,
   `dhl`, `ups`, `fedex`, `auspost`. (The resolver, however, only wires `delhivery`+`shiprocket`.)
4. **Medusa native fulfillment-provider registration — DONE (env-gated).**
   `medusa-config.prod.ts:273` `@medusajs/medusa/fulfillment` `providers: [...]` registers
   manual + each carrier **only when its env creds are present** (`process.env.DELHIVERY_API_TOKEN
   ? [...] : []`, same for `SHIPROCKET_EMAIL`, `DHL_API_KEY`, `UPS_CLIENT_ID`, `FEDEX_CLIENT_ID`,
   `AUSPOST_CLIENT_ID`).
5. **Storefront rate bridge — ALREADY WRITTEN (untested at checkout).**
   `ShiprocketFulfillmentService.calculatePrice()`
   (`src/modules/shipping-providers/shiprocket/service.ts`) maps Medusa's calculated-shipping-option
   context (`from_location.address.postal_code` → `shipping_address.postal_code`, line-item
   `variant.weight`) onto `client.getRates()` and returns the recommended `calculated_amount`
   (`is_calculated_price_tax_inclusive: true`). `canCalculate()` returns `true`. So the building
   block for live checkout rates is in place — it's just **not attached to any service zone /
   calculated shipping option**, so checkout never exercises it.

**So the work is NOT "build an abstraction."** It is four concrete gaps:
**(A)** a typed, **per-tenant** config model (creds today are a single global `SocialPlatform`
row, resolver picks the *first* active match — no partner scope); **(B)** make provider
registration **runtime/admin-managed** instead of boot-time env-gated; **(C)** actually
**attach** the carrier calculated-option to service zones so storefront checkout shows live
rates (+ serviceability fallback); **(D)** **partner-scope** the resolver + a partner config
surface so multi-tenant enablement works.

---

## Grounded gap analysis

### Gap A — credentials are global, not per-tenant
- `resolver.ts:findShippingPlatform()` lists `socials.listSocialPlatforms({ category:"shipping",
  status:"active" })` and returns the **first** row whose `api_config.provider_type|provider|name`
  matches the carrier. **No partner / store / sales-channel filter.** Two partners with their own
  Shiprocket accounts cannot coexist — the resolver can't tell them apart.
- Creds shape: `api_config` with `<field>_encrypted` blobs decrypted via `ENCRYPTION_MODULE`
  (`resolver.ts:readSecret`). Admin edits them through the social-platforms UI
  (`src/admin/components/social-platforms/shipping-provider-fields.tsx`).
- There is **no typed shipping-provider config model** — settings live in the untyped
  `SocialPlatform.api_config` JSON. (Consistent with the repo rule: load-bearing config should be
  typed columns, not a metadata/JSON blob — see memory `feedback_no_critical_data_in_metadata`.)

### Gap B — registration is boot-time env-gated, not admin-managed
- A carrier only becomes a *selectable Medusa fulfillment provider* if its env var is set at boot
  (`medusa-config.prod.ts` ternaries). An admin who adds creds via the social-platforms UI at
  runtime gets a working **resolver** (label/track/pickup routes) but the carrier still won't
  appear in the **native shipping-options provider dropdown** unless the env was set at deploy time.
  This split is the core "not cleanly exposed in the places that matter" complaint in #649.

### Gap C — storefront checkout never shows live rates
- `calculatePrice` exists (Gap-5 above) but no seed/admin step creates a *calculated* shipping
  option bound to provider `shiprocket` on a service zone. Grep: shipping-option seeding is the
  stock Medusa flow; no carrier-backed calculated option is created anywhere under `src/scripts`.
- No serviceability gate / fallback: `calculatePrice` returns `calculated_amount: 0` on a
  non-6-digit pin or any error (`service.ts` catch). A 0 silently becomes "free shipping" at
  checkout rather than "lane not serviceable → hide option". `ShippingProviderClient.checkServiceability`
  is declared but unused.

### Gap D — partners cannot enable/scope carriers
- `#639` partner routes (`src/api/partners/orders/[id]/shiprocket-label/route.ts`,
  `.../shiprocket-attach-awb/route.ts`) drive the **platform** Shiprocket account via the global
  resolver — there is no per-partner carrier enablement or creds. The partner-ui buttons for these
  are being finished in an interactive session (#639 tail; **out of this wave**).
- Pickup locations are stored per `stock_location.metadata` (`#435`), not per partner-carrier config.

---

## Open product decisions (these GATE the build — do not guess)

1. **Per-tenant carrier accounts vs one platform account + per-partner pickups?**
   This is the load-bearing decision and ties directly to the Shared-vs-Dedicated tier model
   (memory `project_saas_tiers_doc`). Two coherent options:
   - **D1 — One platform account, per-partner pickup + branding (recommended for Shared tier).**
     JYT's Shiprocket/Delhivery account; each partner gets a registered pickup location
     (already modeled, `#435`) + the resolved seller tax-id (`#348` slice B, `seller-tax-id.ts`).
     Minimal new config; partners never bring creds. Per-partner *enablement* is just a
     boolean + pickup mapping.
   - **D2 — Per-partner carrier accounts (Pro / Dedicated tier).** Each partner stores its own
     encrypted Shiprocket/Delhivery creds → resolver must become partner-scoped. Strictly more
     config + a creds-onboarding UX. Build only when a paying Pro partner needs it.
   - **Recommendation:** build the **config model partner-scoped from day one** (nullable
     `partner_id` / `store_id`), default rows = platform (D1), so D2 is a later data addition, not a
     migration. Mirrors the `partner-payment-config` precedent (per-partner config as a sibling
     model, see CODEBASE_MAP "Partner billing").

2. **Lean on Medusa's native fulfillment-provider contract, or our `ShippingProviderClient`?**
   Both already exist and bridge (the service classes *are* `AbstractFulfillmentProviderService`
   and delegate to the client). Recommendation: **keep both, native = the storefront/checkout +
   shipping-options path; `ShippingProviderClient` resolver = the admin/partner imperative
   label/track/pickup path.** Don't collapse them; document the seam.

3. **Rate caching / serviceability / COD at checkout.** `getRates` hits the live carrier on every
   `calculatePrice`. Decide: cache TTL (per origin→dest→weight bucket), and the "not serviceable"
   contract (return a sentinel the storefront hides vs `amount:0`). COD handling at checkout is
   already partially modeled (`payment_mode` derivation) but not surfaced as a checkout choice.

---

## Proposed PR-by-PR build order (after decisions above)

Each PR is independent off `origin/main` unless noted; backend/API only (UI slices are
Playwright-gated, deferred to an interactive session). All mirror existing patterns.

- **PR-1 (model)** `modules/shipping_provider_config/` — typed config model
  (`provider_type`, `is_enabled`, nullable `partner_id`, nullable `stock_location_id`,
  `default_pickup_location_name`, `enabled_services` text[], `creds_ref` → points at the
  encrypted `SocialPlatform` row so secrets stay in the encryption path). Hand-written
  `create table if not exists` migration (new table = safe per CODEBASE_MAP migration rules);
  register in BOTH `medusa-config.ts` + `.prod.ts`. Pure `resolveProviderConfig(rows, {carrier,
  partnerId})` (partner row wins over platform-default) + unit tests. **No behaviour change yet.**
- **PR-2 (resolver scope)** make `resolveShippingProvider(container, carrier, { partnerId? })`
  consult PR-1's config model first (partner-scoped), falling back to the current
  `findShippingPlatform` global lookup → env. Keep the signature back-compatible
  (`partnerId` optional). Unit-test the precedence (partner cfg → platform cfg → social → env).
- **PR-3 (admin read/registry API)** `GET/POST/PUT /admin/shipping-providers` over PR-1's model
  (list configured carriers, enable/disable, set default pickup). Mirrors the maintenance-jobs
  registry route shape. Per-file integration spec. (Admin UI surface = later Playwright slice.)
- **PR-4 (storefront rate wiring)** a seed/admin step that creates a **calculated** shipping
  option bound to provider `shiprocket`/`delhivery` on the relevant service zone, + a
  serviceability gate in `calculatePrice` (return a "not serviceable" sentinel instead of `0`,
  so the storefront hides the option). Integration spec against the cart shipping-options flow.
- **PR-5 (partner config API)** `GET/POST/PUT /partners/shipping-providers` mirroring PR-3,
  scoped via the partner auth context (mirror `feedback_partner_api_mirrors_admin`). Lets a
  partner enable a carrier + pick its pickup. Per-file integration spec.
- **PR-6 (wire resolver `partnerId`)** thread the partner id into the #639 partner label/track
  routes' `resolveShippingProvider(..., { partnerId })` call so they pick the partner's config.
- **Deferred / Playwright-gated (interactive session):** admin "Shipping Providers" settings UI,
  partner-ui carrier-config surface, partner-ui #639 label/attach buttons (already in flight).
- **Deferred (decision D2):** per-partner creds onboarding (only when a Pro partner needs it).

## Watch-outs (carried from grounding)
- Resolver `SUPPORTED_CARRIERS` only has delhivery+shiprocket though SIX adapters are registered
  — dhl/ups/fedex/auspost are native-fulfillment-only today; the imperative resolver path doesn't
  drive them. Decide whether PR-2 extends `SUPPORTED_CARRIERS` or leaves them native-only.
- `medusa-config.ts` (base, what `medusa develop` + integration tests load) registers FEWER
  providers than `.prod.ts` — verify any new provider wiring lands in BOTH
  (memory `reference_two_medusa_config_files`).
- Creds must stay in the encryption path (`ENCRYPTION_MODULE`); the new config model holds a
  *reference* to the encrypted `SocialPlatform` row, never plaintext secrets.
- `calculatePrice` returning `0` today = silent free shipping; PR-4 must change this contract.
</content>
</invoke>
